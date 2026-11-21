import {
  Career,
  LearningRoadmap,
  LLMConfig,
  normalizeLLMProvider,
  RoadmapAIValidationStatus,
  SkillGapAnalysis,
  UserProfile
} from '../../types';

export interface RefineRoadmapResult {
  roadmap: LearningRoadmap;
  usedAI: boolean;
  modelUsed: string;
  validationStatus?: RoadmapAIValidationStatus;
  errorNotice?: string;
}

const refinementCache = new Map<string, RefineRoadmapResult>();

function buildCacheKey(
  profile: UserProfile,
  career: Career,
  baseRoadmap: LearningRoadmap,
  llmConfig?: LLMConfig
): string {
  const examsKey = (baseRoadmap.plannedExams || []).join(',');
  const ratioKey = baseRoadmap.allocation
    ? `${baseRoadmap.allocation.examRatio}/${baseRoadmap.allocation.skillRatio}`
    : 'def';
  const timeKey = profile.examScores?.timeUntilExam || 'unknown';
  const timelinesKey = JSON.stringify(profile.examScores?.examTimelines || {});
  const gradKey = JSON.stringify(profile.examScores?.thptGraduationSubjects?.electives || []);
  const hoursKey = profile.availableStudyTimeHoursPerWeek || 10;
  const provKey = normalizeLLMProvider(llmConfig?.provider);
  const modelKey = llmConfig?.modelName || 'default';
  const endpointKey = provKey === 'ollama' ? llmConfig?.customEndpoint || '' : '';
  const goalKey = profile.examScores?.studyGoal || '';
  const weakKey = (profile.examScores?.weakTopics || []).join(',');
  return `${profile.id}|${profile.grade || ''}|${career.id}|${examsKey}|${gradKey}|${timelinesKey}|${ratioKey}|${timeKey}|${hoursKey}|${goalKey}|${weakKey}|${provKey}|${modelKey}|${endpointKey}`;
}

/**
 * Calls server-side Hybrid AI Refinement endpoint (/api/ai/roadmap) using active LLMConfig
 * ('gemini' or 'ollama'), or returns deterministic Engine immediately when 'offline-engine'.
 * Never labels offline-engine or fallback output as AI-refined.
 */
export async function refineRoadmapWithAI(
  profile: UserProfile,
  career: Career,
  baseRoadmap: LearningRoadmap,
  skillGap: SkillGapAnalysis,
  llmConfig?: LLMConfig,
  forceRefresh = false
): Promise<RefineRoadmapResult> {
  const canonicalProvider = normalizeLLMProvider(llmConfig?.provider);

  if (canonicalProvider === 'offline-engine') {
    const modelLabel = 'Engine chuẩn hóa (Offline — Không dùng LLM)';
    return {
      roadmap: {
        ...baseRoadmap,
        source: 'engine',
        modelUsed: modelLabel
      },
      usedAI: false,
      modelUsed: modelLabel,
      validationStatus: {
        jsonValid: true,
        schemaValid: true,
        contentAccepted: false,
        aiChangesApplied: false,
        fallbackUsed: false
      }
    };
  }

  const normalizedConfig: LLMConfig = {
    ...(llmConfig || { provider: canonicalProvider, modelName: 'gemini-3.8-flash' }),
    provider: canonicalProvider
  };

  const cacheKey = buildCacheKey(profile, career, baseRoadmap, normalizedConfig);
  if (!forceRefresh && refinementCache.has(cacheKey)) {
    return refinementCache.get(cacheKey)!;
  }

  try {
    const res = await fetch('/api/ai/roadmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile,
        career: {
          id: career.id,
          title: career.title,
          careerCluster: career.careerCluster,
          requiredSkills: career.requiredSkills,
          futureTrends: career.futureTrends,
          aiImpact: career.aiImpact
        },
        baseRoadmap,
        skillGap: {
          overallReadiness: skillGap.overallReadiness,
          missingSkills: skillGap.missingSkills.slice(0, 6).map(s => s.skill),
          developingSkills: skillGap.developingSkills.slice(0, 6).map(s => s.skill),
          strongSkills: skillGap.strongSkills.slice(0, 6).map(s => s.skill)
        },
        llmConfig: normalizedConfig
      }),
      signal: AbortSignal.timeout(22000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const validationStatus: RoadmapAIValidationStatus | undefined =
      data.validationStatus || data.roadmap?.aiValidationStatus;

    // Strict check: only report usedAI when backend explicitly applied validated AI changes
    const usedAI = Boolean(
      data.usedAI &&
        (validationStatus ? validationStatus.aiChangesApplied && !validationStatus.fallbackUsed : true)
    );

    const result: RefineRoadmapResult = {
      roadmap: data.roadmap || { ...baseRoadmap, source: 'engine' },
      usedAI,
      modelUsed: data.modelUsed || 'Engine chuẩn hóa (Fallback)',
      validationStatus,
      errorNotice: data.errorNotice
    };

    if (usedAI) {
      refinementCache.set(cacheKey, result);
    }
    return result;
  } catch (err: any) {
    const providerLabel = canonicalProvider === 'ollama' ? 'Local LLM (Ollama)' : 'Gemini';
    return {
      roadmap: {
        ...baseRoadmap,
        source: 'engine',
        modelUsed: `Engine chuẩn hóa (Fallback từ ${providerLabel})`,
        aiValidationStatus: {
          jsonValid: false,
          schemaValid: false,
          contentAccepted: false,
          aiChangesApplied: false,
          fallbackUsed: true,
          rejectedReasons: [err?.message || 'Lỗi kết nối máy chủ AI']
        }
      },
      usedAI: false,
      modelUsed: `Engine chuẩn hóa (Fallback từ ${providerLabel})`,
      errorNotice: `Không thể tinh chỉnh bằng ${providerLabel} lúc này (${err?.message || 'mất kết nối'}). Hệ thống đang giữ nguyên lộ trình chuẩn hóa từ Engine.`
    };
  }
}
