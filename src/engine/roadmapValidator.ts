import {
  LearningRoadmap,
  PlannedExamCode,
  RoadmapAIValidationStatus,
  RoadmapPhase,
  StudyTaskItem
} from '../types';

export interface RoadmapValidationResult {
  roadmap: LearningRoadmap;
  validated: boolean;
  jsonValid: boolean;
  schemaValid: boolean;
  contentAccepted: boolean;
  aiChangesApplied: boolean;
  fallbackUsed: boolean;
  warnings: string[];
  rejectedReasons: string[];
}

const ALL_EXAM_CODES: PlannedExamCode[] = ['THPT', 'HSA', 'V-ACT', 'TSA'];

// Specialized tools/deliverables prohibited during Grade 12 pre-exam phases
const SPECIALIZED_PREEXAM_TERMS = [
  'react',
  'next.js',
  'nextjs',
  'angular',
  'vue',
  'kubernetes',
  'docker',
  'tensorflow',
  'pytorch',
  'microservices',
  'capstone',
  'khóa luận tốt nghiệp',
  'kiến trúc hệ thống phân tán',
  'figma prototype',
  'ui/ux portfolio',
  'nộp cv thực tập',
  'ứng tuyển thực tập',
  'xây dựng ứng dụng full-stack',
  'xây dựng hệ thống backend'
];

// Foundational skills explicitly permitted during pre-exam phases
const ALLOWED_FOUNDATIONAL_CONTEXT_RX =
  /(đọc hiểu|quản lý thời gian|luyện đề|sổ tay lỗi sai|tư duy logic|tiếng anh học thuật|tin học cơ bản|ôn tập|chẩn đoán)/i;

// Unverified claims / hallucinated admissions guarantees / invented dates
const HALLUCINATED_CLAIM_PATTERNS = [
  /tỷ lệ\s*(đỗ|trúng tuyển)\s*\d+\s*%/i,
  /xác suất\s*(đỗ|trúng tuyển)\s*\d+\s*%/i,
  /chắc chắn\s*(đỗ|trúng tuyển)/i,
  /cam kết\s*(đỗ|đạt)\s*\d+/i,
  /ngày thi chính thức\s*\d{1,2}\/\d{1,2}/i,
  /điểm chuẩn\s*(năm nay|chính thức|chắc chắn)\s*(là|=|:)?\s*\d{2}/i
];

function containsUnselectedExam(
  text: string,
  allowedExams: PlannedExamCode[],
  isGrade12: boolean
): PlannedExamCode | null {
  if (!isGrade12 || !text) return null;
  const upper = text.toUpperCase();
  for (const code of ALL_EXAM_CODES) {
    if (allowedExams.includes(code)) continue;
    const regex = new RegExp(`\\b${code.replace('-', '\\-')}\\b`, 'i');
    if (regex.test(upper)) {
      return code;
    }
  }
  return null;
}

function detectDisallowedPreExamContent(
  text: string,
  taskCategory?: unknown,
  weeklyBudget?: number
): string | null {
  const lower = text.toLowerCase();

  // 1. Check structured taskCategory metadata if AI returned one
  if (typeof taskCategory === 'string') {
    const cat = taskCategory.toLowerCase();
    if (
      cat === 'specialized-project' ||
      cat === 'capstone' ||
      cat === 'internship-prep' ||
      cat === 'domain-framework'
    ) {
      return 'phân loại nhiệm vụ thuộc nhóm dự án chuyên ngành/thực tập không phù hợp trước kỳ thi';
    }
  }

  // 2. Semantic specialized domain/tool overload check (unless genuinely foundational context without heavy deliverable)
  const hitTerm = SPECIALIZED_PREEXAM_TERMS.find(kw => lower.includes(kw));
  if (hitTerm) {
    return `đưa nội dung chuyên ngành nặng ("${hitTerm}") vào giai đoạn Trước kỳ thi`;
  }

  // 3. Check heavy project/portfolio build verbs when NOT foundational study skills
  if (
    /(xây dựng\s+dự án\s+(lớn|thực tế|doanh nghiệp)|triển khai\s+hệ thống|làm\s+portfolio\s+chuyên ngành)/i.test(
      lower
    ) &&
    !ALLOWED_FOUNDATIONAL_CONTEXT_RX.test(lower)
  ) {
    return 'đưa dự án chuyên ngành nặng vào giai đoạn Trước kỳ thi';
  }

  // 4. Budget sanity check: prevent AI from prescribing single task hours exceeding weekly budget
  if (typeof weeklyBudget === 'number' && weeklyBudget > 0) {
    const hourMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(giờ|h)\s*\/\s*tuần/i);
    if (hourMatch) {
      const mentionedHours = parseFloat(hourMatch[1].replace(',', '.'));
      if (Number.isFinite(mentionedHours) && mentionedHours > weeklyBudget + 0.5) {
        return `đề xuất thời lượng (${mentionedHours}h/tuần) vượt quá quỹ tự học (${weeklyBudget}h/tuần)`;
      }
    }
  }

  return null;
}

function containsHallucinatedClaim(text: string): boolean {
  return HALLUCINATED_CLAIM_PATTERNS.some(rx => rx.test(text));
}

function validateTextCandidate(
  val: unknown,
  options: {
    allowedExams: PlannedExamCode[];
    isGrade12: boolean;
    isPreExam: boolean;
    taskCategory?: unknown;
    weeklyBudget?: number;
    fieldLabel: string;
  },
  warnings: string[],
  rejectedReasons: string[]
): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length < 6 || trimmed.length > 900) return false;

  const badExam = containsUnselectedExam(trimmed, options.allowedExams, options.isGrade12);
  if (badExam) {
    const msg = `Chặn ${options.fieldLabel} từ AI vì nhắc tới kỳ thi chưa được chọn (${badExam}).`;
    warnings.push(msg);
    rejectedReasons.push(msg);
    return false;
  }

  if (options.isPreExam) {
    const preExamIssue = detectDisallowedPreExamContent(
      trimmed,
      options.taskCategory,
      options.weeklyBudget
    );
    if (preExamIssue) {
      const msg = `Chặn ${options.fieldLabel} từ AI vì ${preExamIssue}.`;
      warnings.push(msg);
      rejectedReasons.push(msg);
      return false;
    }
  }

  if (containsHallucinatedClaim(trimmed)) {
    const msg = `Chặn ${options.fieldLabel} từ AI vì chứa cam kết trúng tuyển, điểm chuẩn hoặc ngày thi chưa xác thực.`;
    warnings.push(msg);
    rejectedReasons.push(msg);
    return false;
  }

  return true;
}

function arraysDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((val, idx) => val.trim() !== b[idx].trim());
}

function studyTasksDiffer(a?: StudyTaskItem[], b?: StudyTaskItem[]): boolean {
  if (!a && !b) return false;
  if (!a || !b || a.length !== b.length) return true;
  return a.some((ta, idx) => {
    const tb = b[idx];
    return (
      ta.topicFocus.trim() !== tb.topicFocus.trim() ||
      ta.specificGoal.trim() !== tb.specificGoal.trim() ||
      ta.studyMethod.trim() !== tb.studyMethod.trim() ||
      ta.verificationMethod.trim() !== tb.verificationMethod.trim() ||
      (ta.aiSuggestionNote || '').trim() !== (tb.aiSuggestionNote || '').trim()
    );
  });
}

/**
 * Post-validation guard merging AI refinements cleanly onto the deterministic baseRoadmap.
 * - Preserves student-declared diagnostic weak topics verbatim (never silently overwrites).
 * - Enforces structured pre-exam validation (stageCategory, taskCategory, weekly budget, exam whitelist).
 * - Tracks exact jsonValid, schemaValid, contentAccepted, aiChangesApplied, and fallbackUsed flags.
 */
export function validateAndMergeAIRoadmap(
  baseRoadmap: LearningRoadmap,
  rawAiPayload: unknown,
  modelUsed: string
): RoadmapValidationResult {
  const warnings: string[] = [];
  const rejectedReasons: string[] = [];

  const failFallback = (
    jsonValid: boolean,
    schemaValid: boolean,
    contentAccepted: boolean,
    reason: string
  ): RoadmapValidationResult => {
    const status: RoadmapAIValidationStatus = {
      jsonValid,
      schemaValid,
      contentAccepted,
      aiChangesApplied: false,
      fallbackUsed: true,
      rejectedReasons: [reason, ...rejectedReasons].slice(0, 8)
    };
    const allWarnings = Array.from(new Set([reason, ...warnings]));
    return {
      roadmap: {
        ...baseRoadmap,
        source: 'engine',
        validationWarnings: allWarnings.length > 0 ? allWarnings : undefined,
        aiValidationStatus: status
      },
      validated: false,
      jsonValid,
      schemaValid,
      contentAccepted,
      aiChangesApplied: false,
      fallbackUsed: true,
      warnings: allWarnings,
      rejectedReasons: status.rejectedReasons || []
    };
  };

  let parsed: any = rawAiPayload;
  if (typeof rawAiPayload === 'string') {
    const cleaned = rawAiPayload
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (!cleaned) {
      return failFallback(false, false, false, 'AI trả về phản hồi rỗng — giữ nguyên lộ trình chuẩn hóa từ Engine.');
    }
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return failFallback(false, false, false, 'AI trả về JSON không hợp lệ — giữ nguyên lộ trình chuẩn hóa từ Engine.');
    }
  }

  const jsonValid = true;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failFallback(jsonValid, false, false, 'Cấu trúc JSON từ AI không phải object hợp lệ — giữ nguyên lộ trình Engine.');
  }

  const hasValidPhasesSchema = Array.isArray(parsed.phases) && parsed.phases.length > 0;
  const hasValidNoteSchema = typeof parsed.tailoredNote === 'string' && parsed.tailoredNote.trim().length >= 6;
  const schemaValid = hasValidPhasesSchema || hasValidNoteSchema;

  if (!schemaValid) {
    return failFallback(
      jsonValid,
      false,
      false,
      'Phản hồi AI thiếu trường hợp lệ (phases hoặc tailoredNote) — giữ nguyên lộ trình Engine.'
    );
  }

  const isGrade12 = baseRoadmap.gradeDetected === 'Lớp 12';
  const allowedExams = baseRoadmap.plannedExams || [];
  const weeklyBudget = baseRoadmap.allocation?.totalHoursPerWeek;

  // Track whether at least 1 AI candidate passed validation
  let acceptedFieldCount = 0;

  // 1. Validate tailoredNote
  let mergedTailoredNote = baseRoadmap.tailoredNote;
  if (
    validateTextCandidate(
      parsed.tailoredNote,
      {
        allowedExams,
        isGrade12,
        isPreExam: false,
        weeklyBudget,
        fieldLabel: 'ghi chú tổng quan'
      },
      warnings,
      rejectedReasons
    )
  ) {
    acceptedFieldCount++;
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
    const phaseTaskCategory = aiPhase.taskCategory;

    const refinedObjectives = Array.isArray(aiPhase.objectives)
      ? aiPhase.objectives
          .filter((o: unknown) =>
            validateTextCandidate(
              o,
              {
                allowedExams,
                isGrade12,
                isPreExam,
                taskCategory: phaseTaskCategory,
                weeklyBudget,
                fieldLabel: `mục tiêu giai đoạn ${basePhase.phaseNumber}`
              },
              warnings,
              rejectedReasons
            )
          )
          .map((o: string) => o.trim())
      : [];
    if (refinedObjectives.length > 0) acceptedFieldCount++;

    const refinedActivities = Array.isArray(aiPhase.recommendedActivities)
      ? aiPhase.recommendedActivities
          .filter((a: unknown) =>
            validateTextCandidate(
              a,
              {
                allowedExams,
                isGrade12,
                isPreExam,
                taskCategory: phaseTaskCategory,
                weeklyBudget,
                fieldLabel: `hoạt động giai đoạn ${basePhase.phaseNumber}`
              },
              warnings,
              rejectedReasons
            )
          )
          .map((a: string) => a.trim())
      : [];
    if (refinedActivities.length > 0) acceptedFieldCount++;

    const refinedMilestone = validateTextCandidate(
      aiPhase.milestone,
      {
        allowedExams,
        isGrade12,
        isPreExam,
        taskCategory: phaseTaskCategory,
        weeklyBudget,
        fieldLabel: `cột mốc giai đoạn ${basePhase.phaseNumber}`
      },
      warnings,
      rejectedReasons
    )
      ? (acceptedFieldCount++, aiPhase.milestone.trim())
      : basePhase.milestone;

    // Refine studyTasks ONLY on safe fields while strictly preserving student diagnostic info & hours
    let mergedStudyTasks: StudyTaskItem[] | undefined = basePhase.studyTasks;
    if (basePhase.studyTasks && Array.isArray(aiPhase.studyTasks)) {
      mergedStudyTasks = basePhase.studyTasks.map((baseTask, tIdx) => {
        const aiTask = aiPhase.studyTasks[tIdx];
        if (!aiTask || typeof aiTask !== 'object') return baseTask;

        const taskCat = aiTask.taskCategory ?? phaseTaskCategory;

        const safeGoal = validateTextCandidate(
          aiTask.specificGoal,
          {
            allowedExams,
            isGrade12,
            isPreExam,
            taskCategory: taskCat,
            weeklyBudget,
            fieldLabel: 'mục tiêu nhiệm vụ'
          },
          warnings,
          rejectedReasons
        )
          ? (acceptedFieldCount++, aiTask.specificGoal.trim())
          : baseTask.specificGoal;

        const safeMethod = validateTextCandidate(
          aiTask.studyMethod,
          {
            allowedExams,
            isGrade12,
            isPreExam,
            taskCategory: taskCat,
            weeklyBudget,
            fieldLabel: 'phương pháp học'
          },
          warnings,
          rejectedReasons
        )
          ? (acceptedFieldCount++, aiTask.studyMethod.trim())
          : baseTask.studyMethod;

        const safeVerify = validateTextCandidate(
          aiTask.verificationMethod,
          {
            allowedExams,
            isGrade12,
            isPreExam,
            taskCategory: taskCat,
            weeklyBudget,
            fieldLabel: 'cách kiểm chứng'
          },
          warnings,
          rejectedReasons
        )
          ? (acceptedFieldCount++, aiTask.verificationMethod.trim())
          : baseTask.verificationMethod;

        // Priority 4A: Preserve student diagnostic weak topics verbatim
        let safeTopicFocus = baseTask.topicFocus;
        let aiSuggestionNote = baseTask.aiSuggestionNote;

        if (
          validateTextCandidate(
            aiTask.topicFocus,
            {
              allowedExams,
              isGrade12,
              isPreExam,
              taskCategory: taskCat,
              weeklyBudget,
              fieldLabel: 'chuyên đề trọng tâm'
            },
            warnings,
            rejectedReasons
          )
        ) {
          const candidateTopic = aiTask.topicFocus.trim();
          if (!baseTask.hasTopicDiagnostic) {
            const msg = 'Chặn AI tự điền chuyên đề yếu khi học sinh chưa có dữ liệu chẩn đoán.';
            warnings.push(msg);
            rejectedReasons.push(msg);
          } else if (baseTask.originalWeakTopics && baseTask.originalWeakTopics.length > 0) {
            const lowerCand = candidateTopic.toLowerCase();
            const preservesAllOriginals = baseTask.originalWeakTopics.every(wt =>
              lowerCand.includes(wt.trim().toLowerCase())
            );
            if (preservesAllOriginals) {
              acceptedFieldCount++;
              safeTopicFocus = candidateTopic;
            } else {
              const msg = `Giữ nguyên chuyên đề yếu gốc của học sinh (${baseTask.originalWeakTopics.join(', ')}) thay vì cho AI ghi đè.`;
              warnings.push(msg);
              rejectedReasons.push(msg);
              if (candidateTopic !== baseTask.topicFocus) {
                acceptedFieldCount++;
                aiSuggestionNote = `Gợi ý bổ sung từ AI: ${candidateTopic}`;
              }
            }
          } else {
            acceptedFieldCount++;
            safeTopicFocus = candidateTopic;
          }
        }

        return {
          ...baseTask,
          topicFocus: safeTopicFocus,
          specificGoal: safeGoal,
          studyMethod: safeMethod,
          verificationMethod: safeVerify,
          aiSuggestionNote
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

  // 3. Determine whether any real change vs baseRoadmap occurred
  const noteChanged = mergedTailoredNote.trim() !== baseRoadmap.tailoredNote.trim();
  const phasesChanged = mergedPhases.some((mp, idx) => {
    const bp = baseRoadmap.phases[idx];
    if (!bp) return true;
    return (
      mp.milestone.trim() !== bp.milestone.trim() ||
      arraysDiffer(mp.objectives, bp.objectives) ||
      arraysDiffer(mp.recommendedActivities, bp.recommendedActivities) ||
      studyTasksDiffer(mp.studyTasks, bp.studyTasks)
    );
  });

  const aiChangesApplied = noteChanged || phasesChanged;
  const contentAccepted = acceptedFieldCount > 0;
  const validated = jsonValid && schemaValid && contentAccepted && aiChangesApplied;

  if (!validated) {
    const reason = !contentAccepted
      ? 'Nội dung AI không đạt tiêu chuẩn kiểm định an toàn — hệ thống giữ nguyên lộ trình Engine.'
      : 'Phản hồi AI không tạo ra thay đổi mới có ích so với lộ trình Engine chuẩn — giữ nguyên bản Engine.';
    return failFallback(jsonValid, schemaValid, contentAccepted, reason);
  }

  const aiValidationStatus: RoadmapAIValidationStatus = {
    jsonValid,
    schemaValid,
    contentAccepted,
    aiChangesApplied,
    fallbackUsed: false,
    rejectedReasons: rejectedReasons.length > 0 ? rejectedReasons : undefined
  };

  return {
    roadmap: {
      ...baseRoadmap,
      tailoredNote: mergedTailoredNote,
      phases: mergedPhases,
      source: 'ai-hybrid',
      modelUsed,
      validationWarnings: warnings.length > 0 ? warnings : undefined,
      aiValidationStatus
    },
    validated: true,
    jsonValid,
    schemaValid,
    contentAccepted,
    aiChangesApplied,
    fallbackUsed: false,
    warnings,
    rejectedReasons
  };
}
