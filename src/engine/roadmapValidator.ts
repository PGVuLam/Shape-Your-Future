import { LearningRoadmap, PlannedExamCode, RoadmapPhase, StudyTaskItem } from '../types';

export interface RoadmapValidationResult {
  roadmap: LearningRoadmap;
  validated: boolean;
  warnings: string[];
}

const ALL_EXAM_CODES: PlannedExamCode[] = ['THPT', 'HSA', 'V-ACT', 'TSA'];

const SPECIALIZED_PREEXAM_BLOCKLIST = [
  'react',
  'next.js',
  'angular',
  'vue',
  'kubernetes',
  'docker',
  'tensorflow',
  'pytorch',
  'microservices',
  'capstone',
  'khóa luận tốt nghiệp',
  'kiến trúc hệ thống phân tán'
];

const HALLUCINATED_CLAIM_PATTERNS = [
  /tỷ lệ\s*(đỗ|trúng tuyển)\s*\d+\s*%/i,
  /chắc chắn\s*(đỗ|trúng tuyển)/i,
  /cam kết\s*(đỗ|đạt)\s*\d+/i,
  /ngày thi chính thức\s*\d{1,2}\/\d{1,2}/i
];

function containsUnselectedExam(text: string, allowedExams: PlannedExamCode[], isGrade12: boolean): PlannedExamCode | null {
  if (!isGrade12 || !text) return null;
  const upper = text.toUpperCase();
  for (const code of ALL_EXAM_CODES) {
    if (allowedExams.includes(code)) continue;
    // Word-boundary check to avoid false positives
    const regex = new RegExp(`\\b${code.replace('-', '\\-')}\\b`, 'i');
    if (regex.test(upper)) {
      return code;
    }
  }
  return null;
}

function containsSpecializedBlocklist(text: string): boolean {
  const lower = text.toLowerCase();
  return SPECIALIZED_PREEXAM_BLOCKLIST.some(kw => lower.includes(kw));
}

function containsHallucinatedClaim(text: string): boolean {
  return HALLUCINATED_CLAIM_PATTERNS.some(rx => rx.test(text));
}

function isSafeString(
  val: unknown,
  allowedExams: PlannedExamCode[],
  isGrade12: boolean,
  isPreExam: boolean,
  warnings: string[],
  fieldLabel: string
): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length < 6 || trimmed.length > 800) return false;

  const badExam = containsUnselectedExam(trimmed, allowedExams, isGrade12);
  if (badExam) {
    warnings.push(`Đã chặn ${fieldLabel} từ AI vì nhắc tới kỳ thi chưa được chọn (${badExam}).`);
    return false;
  }

  if (isPreExam && containsSpecializedBlocklist(trimmed)) {
    warnings.push(`Đã chặn ${fieldLabel} từ AI vì đưa kỹ năng chuyên ngành nặng vào giai đoạn Trước kỳ thi.`);
    return false;
  }

  if (containsHallucinatedClaim(trimmed)) {
    warnings.push(`Đã chặn ${fieldLabel} từ AI vì chứa cam kết trúng tuyển hoặc ngày thi chưa xác thực.`);
    return false;
  }

  return true;
}

/**
 * Post-validation guard merging AI refinements cleanly onto the deterministic baseRoadmap.
 * Never lets AI alter ratios, exam selections, stage categories, or fabricate weak topics/scores.
 */
export function validateAndMergeAIRoadmap(
  baseRoadmap: LearningRoadmap,
  rawAiPayload: unknown,
  modelUsed: string
): RoadmapValidationResult {
  const warnings: string[] = [];

  let parsed: any = rawAiPayload;
  if (typeof rawAiPayload === 'string') {
    try {
      const cleaned = rawAiPayload
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        roadmap: { ...baseRoadmap, source: 'engine' },
        validated: false,
        warnings: ['AI trả về JSON không hợp lệ — giữ nguyên lộ trình chuẩn hóa từ Engine.']
      };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      roadmap: { ...baseRoadmap, source: 'engine' },
      validated: false,
      warnings: ['Cấu trúc phản hồi AI không hợp lệ — giữ nguyên lộ trình chuẩn hóa từ Engine.']
    };
  }

  const isGrade12 = baseRoadmap.gradeDetected === 'Lớp 12';
  const allowedExams = baseRoadmap.plannedExams || [];

  // 1. Validate tailoredNote
  let mergedTailoredNote = baseRoadmap.tailoredNote;
  if (
    isSafeString(parsed.tailoredNote, allowedExams, isGrade12, false, warnings, 'ghi chú tổng quan')
  ) {
    mergedTailoredNote = parsed.tailoredNote.trim();
  }

  // 2. Validate & merge each phase strictly against baseRoadmap structure
  const aiPhases: any[] = Array.isArray(parsed.phases) ? parsed.phases : [];
  const mergedPhases: RoadmapPhase[] = baseRoadmap.phases.map((basePhase, idx) => {
    const aiPhase =
      aiPhases.find(p => p && Number(p.phaseNumber) === basePhase.phaseNumber) ||
      aiPhases[idx];

    if (!aiPhase || typeof aiPhase !== 'object') {
      return basePhase;
    }

    const isPreExam = basePhase.stageCategory === 'pre-exam';

    const refinedObjectives = Array.isArray(aiPhase.objectives)
      ? aiPhase.objectives.filter((o: unknown) =>
          isSafeString(o, allowedExams, isGrade12, isPreExam, warnings, `mục tiêu giai đoạn ${basePhase.phaseNumber}`)
        )
      : [];

    const refinedActivities = Array.isArray(aiPhase.recommendedActivities)
      ? aiPhase.recommendedActivities.filter((a: unknown) =>
          isSafeString(a, allowedExams, isGrade12, isPreExam, warnings, `hoạt động giai đoạn ${basePhase.phaseNumber}`)
        )
      : [];

    const refinedMilestone = isSafeString(
      aiPhase.milestone,
      allowedExams,
      isGrade12,
      isPreExam,
      warnings,
      `cột mốc giai đoạn ${basePhase.phaseNumber}`
    )
      ? aiPhase.milestone.trim()
      : basePhase.milestone;

    // Refine studyTasks ONLY on goal/method/verification while locking subject, topicFocus, and diagnostic flag
    let mergedStudyTasks: StudyTaskItem[] | undefined = basePhase.studyTasks;
    if (basePhase.studyTasks && Array.isArray(aiPhase.studyTasks)) {
      mergedStudyTasks = basePhase.studyTasks.map((baseTask, tIdx) => {
        const aiTask = aiPhase.studyTasks[tIdx];
        if (!aiTask || typeof aiTask !== 'object') return baseTask;

        const safeGoal = isSafeString(
          aiTask.specificGoal,
          allowedExams,
          isGrade12,
          isPreExam,
          warnings,
          'mục tiêu nhiệm vụ'
        )
          ? aiTask.specificGoal.trim()
          : baseTask.specificGoal;

        const safeMethod = isSafeString(
          aiTask.studyMethod,
          allowedExams,
          isGrade12,
          isPreExam,
          warnings,
          'phương pháp học'
        )
          ? aiTask.studyMethod.trim()
          : baseTask.studyMethod;

        const safeVerify = isSafeString(
          aiTask.verificationMethod,
          allowedExams,
          isGrade12,
          isPreExam,
          warnings,
          'cách kiểm chứng'
        )
          ? aiTask.verificationMethod.trim()
          : baseTask.verificationMethod;

        // If baseTask had NO topic diagnostic, AI MUST NOT invent one
        let safeTopicFocus = baseTask.topicFocus;
        if (
          baseTask.hasTopicDiagnostic &&
          isSafeString(aiTask.topicFocus, allowedExams, isGrade12, isPreExam, warnings, 'chuyên đề trọng tâm')
        ) {
          safeTopicFocus = aiTask.topicFocus.trim();
        }

        return {
          ...baseTask,
          topicFocus: safeTopicFocus,
          specificGoal: safeGoal,
          studyMethod: safeMethod,
          verificationMethod: safeVerify
        };
      });
    }

    return {
      ...basePhase,
      objectives: refinedObjectives.length > 0 ? refinedObjectives.slice(0, 4) : basePhase.objectives,
      recommendedActivities:
        refinedActivities.length > 0 ? refinedActivities.slice(0, 4) : basePhase.recommendedActivities,
      milestone: refinedMilestone,
      studyTasks: mergedStudyTasks,
      // Lock foundational/specialized split strictly to deterministic engine
      foundationalSkills: basePhase.foundationalSkills,
      specializedSkills: basePhase.specializedSkills
    };
  });

  return {
    roadmap: {
      ...baseRoadmap,
      tailoredNote: mergedTailoredNote,
      phases: mergedPhases,
      source: 'ai-hybrid',
      modelUsed,
      validationWarnings: warnings.length > 0 ? warnings : undefined
    },
    validated: true,
    warnings
  };
}
