import assert from 'node:assert/strict';
import { CAREER_DATABASE } from '../src/data/careers';
import { analyzeSkillGap } from '../src/engine/skillGapEngine';
import {
  detectHighSchoolGrade,
  generateLearningRoadmap
} from '../src/engine/roadmapEngine';
import { validateAndMergeAIRoadmap } from '../src/engine/roadmapValidator';
import { refineRoadmapWithAI } from '../src/services/ai/roadmapRefinementService';
import {
  AgeGroup,
  normalizeLLMProvider,
  THPT_COMPULSORY_SUBJECTS,
  UserProfile
} from '../src/types';
import { createEmptyProfile } from '../src/utils/ageGroupUtils';

function makeTestProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  const base = createEmptyProfile(overrides.ageGroup || '15-18');
  return {
    ...base,
    name: 'Học sinh Kiểm thử',
    age: 17,
    grade: 'Lớp 12',
    favoriteSubjects: ['Toán học', 'Vật lý'],
    confidentSubjects: ['Toán học'],
    skills: ['Tư duy logic', 'Tự học'],
    availableStudyTimeHoursPerWeek: 10,
    ...overrides,
    examScores: {
      ...base.examScores,
      ...(overrides.examScores || {})
    }
  };
}

const sampleCareer = CAREER_DATABASE.find(c => c.id === 'software-engineer') || CAREER_DATABASE[0];

async function runTests() {
  let passed = 0;
  const runCase = async (name: string, fn: () => void | Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  };

  // =========================================================================
  // SCENARIO A: THPT Graduation Subjects vs University Admission Combination
  // =========================================================================
  await runCase('Scenario A1: THPT study tasks use Circular 24/2024 graduation subjects (not A00)', () => {
    const profile = makeTestProfile({
      age: 17,
      grade: 'Lớp 12',
      examScores: {
        plannedExams: ['THPT'],
        thptAdmissionCombo: 'A00 (Toán, Lý, Hóa)',
        thptGraduationSubjects: {
          compulsory: [...THPT_COMPULSORY_SUBJECTS],
          electives: ['Vật lý', 'Tiếng Anh']
        },
        timeUntilExam: '3–6 tháng'
      }
    });
    const gap = analyzeSkillGap(profile, sampleCareer);
    const roadmap = generateLearningRoadmap(profile, sampleCareer, gap);

    assert.equal(roadmap.needsGraduationSubjectsConfirmation, false);
    const preExamPhase = roadmap.phases.find(p => p.stageCategory === 'pre-exam');
    assert.ok(preExamPhase, 'Should have pre-exam phase');

    const thptTask = preExamPhase.studyTasks?.find(t => t.examCode === 'THPT');
    assert.ok(thptTask, 'Should include THPT study task');

    const taskBlob = `${thptTask.subjectOrCompetency} | ${thptTask.topicFocus} | ${thptTask.specificGoal}`;
    assert.ok(taskBlob.includes('Toán học'), 'THPT task should include compulsory Toán học');
    assert.ok(taskBlob.includes('Ngữ văn'), 'THPT task should include compulsory Ngữ văn');
    assert.ok(taskBlob.includes('Vật lý'), 'THPT task should include elective Vật lý');
    assert.ok(taskBlob.includes('Tiếng Anh'), 'THPT task should include elective Tiếng Anh');
    assert.ok(!thptTask.subjectOrCompetency.includes('Hóa'), 'THPT graduation study subjects must NOT pull Hóa from A00');
  });

  await runCase('Scenario A2: Missing graduation electives flags confirmation instead of guessing from A00', () => {
    const profile = makeTestProfile({
      grade: 'Lớp 12',
      examScores: {
        plannedExams: ['THPT'],
        thptAdmissionCombo: 'A00 (Toán, Lý, Hóa)',
        thptGraduationSubjects: {
          compulsory: [...THPT_COMPULSORY_SUBJECTS],
          electives: []
        }
      }
    });
    const gap = analyzeSkillGap(profile, sampleCareer);
    const roadmap = generateLearningRoadmap(profile, sampleCareer, gap);

    assert.equal(roadmap.needsGraduationSubjectsConfirmation, true);
    const preExamPhase = roadmap.phases.find(p => p.stageCategory === 'pre-exam');
    const thptTask = preExamPhase?.studyTasks?.find(t => t.examCode === 'THPT');
    assert.ok(thptTask, 'THPT task still generated safely');
    assert.ok(!thptTask.topicFocus.includes('Hóa học'), 'Must not infer Hóa học graduation subject from A00');
  });

  // =========================================================================
  // SCENARIO B: Explicit Grade Detection vs Missing Grade Confirmation
  // =========================================================================
  await runCase('Scenario B1: Age 17 with explicit Lớp 12 stays Grade 12 (no age coercion to Grade 11)', () => {
    const profile = makeTestProfile({ age: 17, ageGroup: '15-18', grade: 'Lớp 12' });
    const detected = detectHighSchoolGrade(profile);
    assert.equal(detected.grade, '12');
    assert.equal(detected.needsConfirmation, false);

    const gap = analyzeSkillGap(profile, sampleCareer);
    const roadmap = generateLearningRoadmap(profile, sampleCareer, gap);
    assert.equal(roadmap.gradeDetected, 'Lớp 12');
    assert.equal(roadmap.needsGradeConfirmation, false);
    assert.ok(roadmap.phases.some(p => p.stageCategory === 'pre-exam'));
  });

  await runCase('Scenario B2: Missing grade for 15-18 triggers needsGradeConfirmation with non-binding hint', () => {
    const profile = makeTestProfile({ age: 17, ageGroup: '15-18', grade: '' });
    const detected = detectHighSchoolGrade(profile);
    assert.equal(detected.grade, null);
    assert.equal(detected.suggestedGrade, '11');
    assert.equal(detected.needsConfirmation, true);

    const gap = analyzeSkillGap(profile, sampleCareer);
    const roadmap = generateLearningRoadmap(profile, sampleCareer, gap);
    assert.equal(roadmap.needsGradeConfirmation, true);
    assert.equal(roadmap.suggestedGrade, 'Lớp 11');
    assert.equal(roadmap.gradeDetected, 'Chưa xác nhận khối lớp');
  });

  await runCase('Scenario B3: All 6 age groups + Grade 10/11 generate valid phased roadmaps', () => {
    const configs: Array<{ ageGroup: AgeGroup; age: number; grade: string }> = [
      { ageGroup: '6-10', age: 9, grade: 'Lớp 4' },
      { ageGroup: '11-14', age: 13, grade: 'Lớp 8' },
      { ageGroup: '15-18', age: 15, grade: 'Lớp 10' },
      { ageGroup: '15-18', age: 16, grade: 'Lớp 11' },
      { ageGroup: '15-18', age: 18, grade: 'Lớp 12' },
      { ageGroup: '19-24', age: 21, grade: 'Sinh viên Năm 3' },
      { ageGroup: '25-35', age: 29, grade: 'Người đi làm (>3 năm)' },
      { ageGroup: '35+', age: 40, grade: 'Chuyên gia / Quản lý' }
    ];
    for (const cfg of configs) {
      const p = makeTestProfile({
        ageGroup: cfg.ageGroup,
        age: cfg.age,
        grade: cfg.grade,
        availableStudyTimeHoursPerWeek: 3
      });
      const gap = analyzeSkillGap(p, sampleCareer);
      const rm = generateLearningRoadmap(p, sampleCareer, gap);
      assert.ok(rm.phases.length >= 2, `Expected >=2 phases for ${cfg.ageGroup}/${cfg.grade}`);
      assert.ok(rm.tailoredNote.length > 10);
    }
  });

  // =========================================================================
  // SCENARIO C: Weekly Study-Hour Budget Feasibility (3h, 5h, 10h)
  // =========================================================================
  for (const [label, hours, exams] of [
    ['Scenario C1: 3h/week with 2 exams', 3, ['THPT', 'HSA']],
    ['Scenario C2: 5h/week with 4 exams', 5, ['THPT', 'HSA', 'V-ACT', 'TSA']],
    ['Scenario C3: 10h/week with 1 exam', 10, ['THPT']],
    ['Scenario C4: 10h/week with 4 exams', 10, ['THPT', 'HSA', 'V-ACT', 'TSA']]
  ] as const) {
    await runCase(label, () => {
      const profile = makeTestProfile({
        grade: 'Lớp 12',
        availableStudyTimeHoursPerWeek: hours,
        examScores: {
          plannedExams: [...exams],
          thptGraduationSubjects: {
            compulsory: [...THPT_COMPULSORY_SUBJECTS],
            electives: ['Vật lý', 'Tiếng Anh']
          },
          timeUntilExam: '3–6 tháng'
        }
      });
      const gap = analyzeSkillGap(profile, sampleCareer);
      const roadmap = generateLearningRoadmap(profile, sampleCareer, gap);

      assert.ok(roadmap.allocation, 'Should include allocation summary');
      const totalAllocated = roadmap.allocation.examHoursPerWeek + roadmap.allocation.skillHoursPerWeek;
      assert.ok(
        totalAllocated <= hours + 0.05,
        `Exam (${roadmap.allocation.examHoursPerWeek}) + Skill (${roadmap.allocation.skillHoursPerWeek}) = ${totalAllocated} exceeded ${hours}h`
      );

      const examSum = (roadmap.examAllocations || []).reduce((acc, item) => acc + item.hours, 0);
      assert.ok(
        examSum <= roadmap.allocation.examHoursPerWeek + 0.05,
        `Per-exam allocation sum (${examSum}) exceeded examHoursPerWeek (${roadmap.allocation.examHoursPerWeek})`
      );

      for (const a of roadmap.examAllocations || []) {
        assert.ok(a.hours >= 0, 'Allocated hours must be non-negative');
      }

      if (hours <= 5 && exams.length >= 2) {
        assert.ok(
          Boolean(roadmap.allocation.tradeoffWarning),
          'Tight weekly budget with multiple exams must emit tradeoffWarning'
        );
      }
    });
  }

  // =========================================================================
  // SCENARIO D: AI Output Validation & Verbatim Diagnostic Preservation
  // =========================================================================
  const g12Profile = makeTestProfile({
    grade: 'Lớp 12',
    availableStudyTimeHoursPerWeek: 10,
    examScores: {
      plannedExams: ['THPT', 'HSA'],
      thptGraduationSubjects: {
        compulsory: [...THPT_COMPULSORY_SUBJECTS],
        electives: ['Vật lý', 'Tiếng Anh']
      },
      timeUntilExam: '1–3 tháng',
      weakTopics: ['Hình học không gian']
    }
  });
  const g12Gap = analyzeSkillGap(g12Profile, sampleCareer);
  const g12Base = generateLearningRoadmap(g12Profile, sampleCareer, g12Gap);

  await runCase('Scenario D1: Invalid JSON fails cleanly and falls back', () => {
    const res = validateAndMergeAIRoadmap(g12Base, '{not valid json', 'gemini-3.8-flash');
    assert.equal(res.jsonValid, false);
    assert.equal(res.schemaValid, false);
    assert.equal(res.aiChangesApplied, false);
    assert.equal(res.fallbackUsed, true);
    assert.equal(res.validated, false);
    assert.equal(res.roadmap.source, 'engine');
  });

  await runCase('Scenario D2: No-op AI echo returns aiChangesApplied=false & fallbackUsed=true', () => {
    const res = validateAndMergeAIRoadmap(
      g12Base,
      JSON.stringify({
        tailoredNote: g12Base.tailoredNote,
        phases: g12Base.phases
      }),
      'gemini-3.8-flash'
    );
    assert.equal(res.jsonValid, true);
    assert.equal(res.schemaValid, true);
    assert.equal(res.aiChangesApplied, false);
    assert.equal(res.fallbackUsed, true);
    assert.equal(res.validated, false);
  });

  await runCase('Scenario D3: Preserves student weakTopics verbatim when AI tries to alter topicFocus', () => {
    const clonedPhases = JSON.parse(JSON.stringify(g12Base.phases));
    clonedPhases[0].studyTasks[0].topicFocus = 'Nên ôn thêm Giải tích và Tổ hợp xác suất';
    const res = validateAndMergeAIRoadmap(
      g12Base,
      JSON.stringify({
        tailoredNote: `${g12Base.tailoredNote} Bổ sung phân tích lỗi sai mỗi cuối tuần.`,
        phases: clonedPhases
      }),
      'gemini-3.8-flash'
    );

    const firstTask = res.roadmap.phases[0].studyTasks?.[0];
    assert.ok(firstTask, 'Task must exist');
    assert.ok(
      firstTask.topicFocus.includes('Hình học không gian'),
      'Original student weak topic must be preserved verbatim'
    );
    assert.ok(
      firstTask.aiSuggestionNote?.includes('Giải tích'),
      'AI suggestion must be placed in aiSuggestionNote without erasing student diagnostic'
    );
  });

  await runCase('Scenario D4: Rejects pre-exam specialized frameworks, unselected exams & fabricated claims', () => {
    // 1) Mixed payload (echoed base + violating objective): violating text stripped, no AI changes applied
    const mixedPhases = JSON.parse(JSON.stringify(g12Base.phases));
    const badObjective = 'Luyện thi V-ACT cấp tốc với tỷ lệ đỗ 98% và xây dựng React Docker capstone';
    mixedPhases[0].objectives.push(badObjective);
    const mixedRes = validateAndMergeAIRoadmap(
      g12Base,
      JSON.stringify({
        tailoredNote: g12Base.tailoredNote,
        phases: mixedPhases
      }),
      'gemini-3.8-flash'
    );
    assert.ok(mixedRes.rejectedReasons.length >= 1, 'Violations must be recorded in rejectedReasons');
    assert.ok(
      !mixedRes.roadmap.phases[0].objectives.includes(badObjective),
      'Disallowed pre-exam objective must be stripped'
    );
    assert.equal(mixedRes.aiChangesApplied, false);
    assert.equal(mixedRes.fallbackUsed, true);

    // 2) Purely violating payload: contentAccepted=false, aiChangesApplied=false, fallbackUsed=true
    const pureBadRes = validateAndMergeAIRoadmap(
      g12Base,
      JSON.stringify({
        tailoredNote: 'Cam kết đỗ Bách Khoa với tỷ lệ đỗ 99% và ngày thi chính thức 15/06.',
        phases: [
          {
            phaseNumber: 1,
            objectives: [badObjective]
          }
        ]
      }),
      'gemini-3.8-flash'
    );
    assert.ok(pureBadRes.rejectedReasons.length >= 2);
    assert.equal(pureBadRes.contentAccepted, false);
    assert.equal(pureBadRes.aiChangesApplied, false);
    assert.equal(pureBadRes.fallbackUsed, true);
  });

  await runCase('Scenario D5: Valid AI refinement sets jsonValid, schemaValid, contentAccepted, aiChangesApplied=true', () => {
    const goodPhases = JSON.parse(JSON.stringify(g12Base.phases));
    goodPhases[0].studyTasks[0].studyMethod =
      'Chia 2 block 45 phút/ngày: 25 phút ôn khái niệm Hình học không gian + 20 phút chấm lại lỗi sai.';
    const res = validateAndMergeAIRoadmap(
      g12Base,
      JSON.stringify({
        tailoredNote: `${g12Base.tailoredNote} Ưu tiên rà soát sổ tay lỗi sai trước mỗi buổi luyện đề.`,
        phases: goodPhases
      }),
      'gemini-3.8-flash'
    );
    assert.equal(res.jsonValid, true);
    assert.equal(res.schemaValid, true);
    assert.equal(res.contentAccepted, true);
    assert.equal(res.aiChangesApplied, true);
    assert.equal(res.fallbackUsed, false);
    assert.equal(res.validated, true);
    assert.equal(res.roadmap.source, 'ai-hybrid');
  });

  // =========================================================================
  // SCENARIO E: Different Exam Timelines & Primary Exam Prioritization
  // =========================================================================
  await runCase('Scenario E: Per-exam timelines prioritize closer/primary exam without fabricating dates', () => {
    const profile = makeTestProfile({
      grade: 'Lớp 12',
      availableStudyTimeHoursPerWeek: 10,
      examScores: {
        plannedExams: ['THPT', 'HSA'],
        thptGraduationSubjects: {
          compulsory: [...THPT_COMPULSORY_SUBJECTS],
          electives: ['Vật lý', 'Tiếng Anh']
        },
        primaryExam: 'HSA',
        examTimelines: {
          HSA: { timeframe: '< 1 tháng', targetDate: 'Đợt 3/2026', isPrimary: true },
          THPT: { timeframe: '3–6 tháng' }
        }
      }
    });
    const gap = analyzeSkillGap(profile, sampleCareer);
    const roadmap = generateLearningRoadmap(profile, sampleCareer, gap);

    const hsaAlloc = roadmap.examAllocations?.find(a => a.exam === 'HSA');
    const thptAlloc = roadmap.examAllocations?.find(a => a.exam === 'THPT');
    assert.ok(hsaAlloc && thptAlloc, 'Both exams should have allocations');
    assert.ok(
      hsaAlloc.hours > thptAlloc.hours,
      `Primary & urgent HSA (${hsaAlloc.hours}h) should receive more hours than THPT (${thptAlloc.hours}h)`
    );

    const preTasks = roadmap.phases[0].studyTasks || [];
    const hsaTask = preTasks.find(t => t.examCode === 'HSA');
    const thptTask = preTasks.find(t => t.examCode === 'THPT');
    assert.equal(hsaTask?.examTimeframe, '< 1 tháng');
    assert.equal(hsaTask?.targetExamDate, 'Đợt 3/2026');
    assert.equal(thptTask?.examTimeframe, '3–6 tháng');
    assert.equal(thptTask?.targetExamDate, undefined);
  });

  // =========================================================================
  // SCENARIO F: Provider Normalization & Offline Engine Separation
  // =========================================================================
  await runCase('Scenario F: Canonical provider mapping and offline-engine non-LLM behavior', async () => {
    assert.equal(normalizeLLMProvider('local'), 'offline-engine');
    assert.equal(normalizeLLMProvider('offline-engine'), 'offline-engine');
    assert.equal(normalizeLLMProvider('custom'), 'ollama');
    assert.equal(normalizeLLMProvider('ollama'), 'ollama');
    assert.equal(normalizeLLMProvider('gemini'), 'gemini');

    const offlineRes = await refineRoadmapWithAI(
      g12Profile,
      sampleCareer,
      g12Base,
      g12Gap,
      {
        provider: 'offline-engine',
        modelName: 'EduPath Deterministic Engine (Offline)',
        customEndpoint: 'http://localhost:11434'
      },
      true
    );
    assert.equal(offlineRes.usedAI, false);
    assert.equal(offlineRes.roadmap.source, 'engine');
    assert.equal(offlineRes.validationStatus?.aiChangesApplied, false);

    const legacyLocalRes = await refineRoadmapWithAI(
      g12Profile,
      sampleCareer,
      g12Base,
      g12Gap,
      { provider: 'local', modelName: 'Legacy Local' },
      true
    );
    assert.equal(legacyLocalRes.usedAI, false);
    assert.equal(legacyLocalRes.roadmap.source, 'engine');
  });

  console.log(`\nALL ROADMAP TESTS PASSED: ${passed}/${passed}`);
}

runTests().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
