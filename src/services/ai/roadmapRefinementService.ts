import { Career, LearningRoadmap, LLMConfig, SkillGapAnalysis, UserProfile } from '../../types';

export interface RefineRoadmapResult {
  roadmap: LearningRoadmap;
  usedAI: boolean;
  modelUsed: string;
  errorNotice?: string;
}

const refinementCache = new Map<string, RefineRoadmapResult>();

function buildCacheKey(profile: UserProfile, career: Career, baseRoadmap: LearningRoadmap, llmConfig?: LLMConfig): string {
  const examsKey = (baseRoadmap.plannedExams || []).join(',');
  const ratioKey = baseRoadmap.allocation ? `${baseRoadmap.allocation.examRatio}/${baseRoadmap.allocation.skillRatio}` : 'def';
  const timeKey = profile.examScores?.timeUntilExam || 'unknown';
  const hoursKey = profile.availableStudyTimeHoursPerWeek || 10;
  const provKey = llmConfig?.provider || 'gemini';
  const modelKey = llmConfig?.modelName || 'default';
  const goalKey = profile.examScores?.studyGoal || '';
  const weakKey = (profile.examScores?.weakTopics || []).join(',');
  return `${profile.id}|${profile.grade || ''}|${career.id}|${examsKey}|${ratioKey}|${timeKey}|${hoursKey}|${goalKey}|${weakKey}|${provKey}|${modelKey}`;
}

/**
 * Calls server-side Hybrid AI Refinement endpoint (/api/ai/roadmap) using active LLMConfig
 * (Gemini or Ollama/Custom), falling back cleanly to the deterministic Engine roadmap when
 * offline or if AI fails/returns invalid data.
 */
export async function refineRoadmapWithAI(
  profile: UserProfile,
  career: Career,
  baseRoadmap: LearningRoadmap,
  skillGap: SkillGapAnalysis,
  llmConfig?: LLMConfig,
  forceRefresh = false
): Promise<RefineRoadmapResult> {
  if (llmConfig?.provider === 'local') {
    return {
      roadmap: { ...baseRoadmap, source: 'engine', modelUsed: 'EduPath Engine (Offline)' },
      usedAI: false,
      modelUsed: 'EduPath Engine (Offline)'
    };
  }

  const cacheKey = buildCacheKey(profile, career, baseRoadmap, llmConfig);
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
        llmConfig
      }),
      signal: AbortSignal.timeout(22000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const result: RefineRoadmapResult = {
      roadmap: data.roadmap || baseRoadmap,
      usedAI: Boolean(data.usedAI),
      modelUsed: data.modelUsed || 'EduPath Engine',
      errorNotice: data.errorNotice
    };

    if (result.usedAI) {
      refinementCache.set(cacheKey, result);
    }
    return result;
  } catch (err: any) {
    return {
      roadmap: { ...baseRoadmap, source: 'engine', modelUsed: 'EduPath Engine (Fallback)' },
      usedAI: false,
      modelUsed: 'EduPath Engine (Fallback)',
      errorNotice: `Không thể tinh chỉnh bằng AI lúc này (${err?.message || 'mất kết nối'}). Hệ thống đang hiển thị lộ trình chuẩn hóa từ Engine.`
    };
  }
}
