import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Target,
  Sparkles,
  Layers,
  AlertTriangle,
  Lightbulb,
  Code2,
  FolderGit2,
  CheckCircle,
  TrendingUp,
  Bot,
  ShieldCheck,
  Brain,
  Sliders,
  Loader2,
  RotateCcw,
  ClipboardCheck
} from 'lucide-react';
import {
  Career,
  ExamTimeframe,
  LearningRoadmap,
  LLMConfig,
  PlannedExamCode,
  RecommendationScore,
  UserProfile
} from '../types';
import { CAREER_DATABASE } from '../data/careers';
import { generateLearningRoadmap } from '../engine/roadmapEngine';
import { analyzeSkillGap } from '../engine/skillGapEngine';
import { analyzeAIImpactAndFutureTrends } from '../engine/aiImpactEngine';
import { refineRoadmapWithAI } from '../services/ai/roadmapRefinementService';
import { useLanguage } from '../context/LanguageContext';

interface LearningRoadmapViewProps {
  profile: UserProfile;
  recommendations?: RecommendationScore[];
  career?: Career;
  onSelectCareer: (career: Career) => void;
  onUpdateStudyHours?: (hours: number) => void;
  onUpdateProfile?: (updated: UserProfile) => void;
  llmConfig?: LLMConfig;
  compactMode?: boolean;
}

export const LearningRoadmapView: React.FC<LearningRoadmapViewProps> = ({
  profile,
  recommendations = [],
  career: initialCareer,
  onSelectCareer,
  onUpdateStudyHours,
  onUpdateProfile,
  llmConfig,
  compactMode = false
}) => {
  const { getCareerTitle } = useLanguage();
  const defaultCareerId = initialCareer?.id || recommendations[0]?.careerId || 'software-engineer';
  const [selectedCareerId, setSelectedCareerId] = useState<string>(defaultCareerId);
  const [viewTab, setViewTab] = useState<'roadmap' | 'skillgap' | 'aiOutlook'>('roadmap');
  const [skillFilter, setSkillFilter] = useState<'all' | 'missing' | 'developing' | 'strong'>('all');

  // Local profile mirror for interactive controls when parent doesn't re-pass immediately
  const [localExamOverride, setLocalExamOverride] = useState<{
    plannedExams?: PlannedExamCode[];
    timeUntilExam?: ExamTimeframe;
    customExamRatio?: number | null;
    weakTopicsText?: string;
    studyGoal?: string;
    hoursPerWeek?: number;
  }>({});

  // Sync career selection if initialCareer changes externally
  useEffect(() => {
    if (initialCareer?.id) {
      setSelectedCareerId(initialCareer.id);
    }
  }, [initialCareer?.id]);

  // Reset local overrides if profile identity changes
  useEffect(() => {
    setLocalExamOverride({});
  }, [profile.id]);

  const effectiveProfile: UserProfile = useMemo(() => {
    const baseExams = profile.examScores || {};
    const nextPlanned =
      localExamOverride.plannedExams !== undefined
        ? localExamOverride.plannedExams
        : baseExams.plannedExams;
    const nextTime =
      localExamOverride.timeUntilExam !== undefined
        ? localExamOverride.timeUntilExam
        : baseExams.timeUntilExam;
    const nextRatio =
      localExamOverride.customExamRatio !== undefined
        ? localExamOverride.customExamRatio === null
          ? undefined
          : localExamOverride.customExamRatio
        : baseExams.customExamRatio;
    const nextWeak =
      localExamOverride.weakTopicsText !== undefined
        ? localExamOverride.weakTopicsText
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : baseExams.weakTopics;
    const nextGoal =
      localExamOverride.studyGoal !== undefined
        ? localExamOverride.studyGoal
        : baseExams.studyGoal;

    return {
      ...profile,
      availableStudyTimeHoursPerWeek:
        localExamOverride.hoursPerWeek ?? profile.availableStudyTimeHoursPerWeek,
      examScores: {
        ...baseExams,
        plannedExams: nextPlanned,
        timeUntilExam: nextTime,
        customExamRatio: nextRatio,
        weakTopics: nextWeak,
        studyGoal: nextGoal
      }
    };
  }, [profile, localExamOverride]);

  const applyProfilePatch = (patch: Partial<typeof localExamOverride>) => {
    setLocalExamOverride(prev => ({ ...prev, ...patch }));
    if (onUpdateProfile) {
      const mergedExams = {
        ...(effectiveProfile.examScores || {}),
        ...(patch.plannedExams !== undefined ? { plannedExams: patch.plannedExams } : {}),
        ...(patch.timeUntilExam !== undefined ? { timeUntilExam: patch.timeUntilExam } : {}),
        ...(patch.customExamRatio !== undefined
          ? { customExamRatio: patch.customExamRatio === null ? undefined : patch.customExamRatio }
          : {}),
        ...(patch.weakTopicsText !== undefined
          ? {
              weakTopics: patch.weakTopicsText
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            }
          : {}),
        ...(patch.studyGoal !== undefined ? { studyGoal: patch.studyGoal } : {})
      };
      onUpdateProfile({
        ...effectiveProfile,
        availableStudyTimeHoursPerWeek:
          patch.hoursPerWeek ?? effectiveProfile.availableStudyTimeHoursPerWeek,
        examScores: mergedExams
      });
    }
  };

  const selectedCareer =
    CAREER_DATABASE.find(c => c.id === selectedCareerId) || initialCareer || CAREER_DATABASE[0];

  const skillGap = useMemo(
    () => analyzeSkillGap(effectiveProfile, selectedCareer),
    [effectiveProfile, selectedCareer]
  );

  const baseRoadmap = useMemo(
    () => generateLearningRoadmap(effectiveProfile, selectedCareer, skillGap),
    [effectiveProfile, selectedCareer, skillGap]
  );

  const aiOutlook = useMemo(
    () => analyzeAIImpactAndFutureTrends(selectedCareer, effectiveProfile, skillGap),
    [selectedCareer, effectiveProfile, skillGap]
  );

  // Hybrid AI Refinement State
  const [aiRefinedRoadmap, setAiRefinedRoadmap] = useState<LearningRoadmap | null>(null);
  const [isRefiningAI, setIsRefiningAI] = useState<boolean>(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  // Clear stale AI refinement whenever base engine inputs change
  useEffect(() => {
    setAiRefinedRoadmap(null);
    setAiNotice(null);
  }, [
    selectedCareer.id,
    effectiveProfile.grade,
    effectiveProfile.ageGroup,
    effectiveProfile.availableStudyTimeHoursPerWeek,
    JSON.stringify(effectiveProfile.examScores?.plannedExams || []),
    effectiveProfile.examScores?.timeUntilExam,
    effectiveProfile.examScores?.customExamRatio,
    JSON.stringify(effectiveProfile.examScores?.weakTopics || []),
    effectiveProfile.examScores?.studyGoal
  ]);

  const activeRoadmap = aiRefinedRoadmap || baseRoadmap;

  const handleRefineWithAI = async () => {
    if (isRefiningAI) return;
    setIsRefiningAI(true);
    setAiNotice(null);
    try {
      const res = await refineRoadmapWithAI(
        effectiveProfile,
        selectedCareer,
        baseRoadmap,
        skillGap,
        llmConfig,
        true
      );
      setAiRefinedRoadmap(res.roadmap);
      if (res.errorNotice) {
        setAiNotice(res.errorNotice);
      } else if (!res.usedAI) {
        setAiNotice('Đang sử dụng lộ trình chuẩn hóa từ Engine (chế độ Offline/Local Engine).');
      }
    } finally {
      setIsRefiningAI(false);
    }
  };

  const handleResetToEngine = () => {
    setAiRefinedRoadmap(null);
    setAiNotice(null);
  };

  const filteredSkills = [
    ...(skillFilter === 'all' || skillFilter === 'missing' ? skillGap.missingSkills : []),
    ...(skillFilter === 'all' || skillFilter === 'developing' ? skillGap.developingSkills : []),
    ...(skillFilter === 'all' || skillFilter === 'strong' ? skillGap.strongSkills : [])
  ];

  const isHighSchool = activeRoadmap.targetAgeGroup === '15-18';
  const currentPlannedExams = effectiveProfile.examScores?.plannedExams || [];
  const currentTimeUntilExam = effectiveProfile.examScores?.timeUntilExam || 'unknown';
  const currentWeakTopicsText =
    localExamOverride.weakTopicsText !== undefined
      ? localExamOverride.weakTopicsText
      : (effectiveProfile.examScores?.weakTopics || []).join(', ');
  const currentHours = effectiveProfile.availableStudyTimeHoursPerWeek || 10;

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-8">
      {/* Header & Top Controls */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <BookOpen className="w-4 h-4" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                Lộ trình Học tập & Hướng nghiệp Cá nhân hóa
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
              {activeRoadmap.stageLabel || 'Lộ trình thích ứng theo độ tuổi'} · Không tự bịa điểm số, ngày thi hay chuyên đề yếu chưa có căn cứ.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {/* Career Selector */}
            {!compactMode && (
              <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl overflow-x-auto max-w-full">
                {recommendations.slice(0, 3).map(rec => {
                  const c = CAREER_DATABASE.find(x => x.id === rec.careerId);
                  if (!c) return null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCareerId(c.id);
                        onSelectCareer(c);
                      }}
                      className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        selectedCareerId === c.id
                          ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 border border-transparent'
                      }`}
                    >
                      {getCareerTitle(c.id, c.title)}
                    </button>
                  );
                })}

                {recommendations.length > 0 && <div className="h-4 w-px bg-slate-300 mx-1" />}

                <select
                  value={
                    !recommendations.slice(0, 3).find(r => r.careerId === selectedCareerId)
                      ? selectedCareerId
                      : ''
                  }
                  onChange={e => {
                    const found = CAREER_DATABASE.find(c => c.id === e.target.value);
                    setSelectedCareerId(e.target.value);
                    if (found) onSelectCareer(found);
                  }}
                  className={`shrink-0 text-xs font-semibold px-2 py-1.5 rounded-lg border-none focus:outline-none cursor-pointer transition-all ${
                    !recommendations.slice(0, 3).find(r => r.careerId === selectedCareerId)
                      ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                      : 'bg-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <option value="" disabled>
                    Ngành khác...
                  </option>
                  {CAREER_DATABASE.filter(
                    c => !recommendations.slice(0, 3).find(r => r.careerId === c.id)
                  ).map(c => (
                    <option key={c.id} value={c.id}>
                      {getCareerTitle(c.id, c.title)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Study Hours Selector */}
            <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-slate-600 font-medium">Tự học:</span>
              <select
                value={currentHours}
                onChange={e => {
                  const h = Number(e.target.value);
                  applyProfilePatch({ hoursPerWeek: h });
                  if (onUpdateStudyHours) onUpdateStudyHours(h);
                }}
                className="font-bold text-indigo-700 bg-transparent border-none focus:outline-none cursor-pointer tabular-nums"
              >
                <option value={5}>5 giờ/tuần</option>
                <option value={8}>8 giờ/tuần</option>
                <option value={10}>10 giờ/tuần</option>
                <option value={15}>15 giờ/tuần</option>
                <option value={20}>20 giờ/tuần</option>
              </select>
            </div>
          </div>
        </div>

        {/* High School / Grade 12 Exam & Ratio Control Panel */}
        {isHighSchool && (
          <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200 space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <span>
                  Cấu hình Kỳ thi & Phân bổ Ôn thi / Kỹ năng ({activeRoadmap.gradeDetected || 'THPT'})
                </span>
              </div>
              {activeRoadmap.allocation && (
                <div className="text-[11px] font-semibold text-slate-600 tabular-nums">
                  Đang áp dụng: <strong className="text-indigo-700">{activeRoadmap.allocation.examRatio}% ôn thi</strong> ·{' '}
                  <strong className="text-emerald-700">{activeRoadmap.allocation.skillRatio}% kỹ năng</strong>{' '}
                  {activeRoadmap.allocation.isUserAdjusted
                    ? '(Tự điều chỉnh)'
                    : activeRoadmap.allocation.isDefault
                    ? '(Mặc định tham khảo)'
                    : '(Tự động theo hồ sơ)'}
                </div>
              )}
            </div>

            {/* Warning if exams not yet confirmed */}
            {activeRoadmap.needsExamConfirmation && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Cần xác nhận kỳ thi tham gia:</strong> Bạn chưa chọn kỳ thi dự định (THPT, HSA, V-ACT hoặc TSA). Hãy tích chọn bên dưới để hệ thống lập lịch ôn chi tiết cho đúng kỳ thi bạn cần.
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Exam Selection Checkboxes */}
              <div className="lg:col-span-5 space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-700 block">
                  Kỳ thi thực tế dự định tham gia:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(['THPT', 'HSA', 'V-ACT', 'TSA'] as PlannedExamCode[]).map(code => {
                    const active = currentPlannedExams.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? currentPlannedExams.filter(x => x !== code)
                            : [...currentPlannedExams, code];
                          applyProfilePatch({ plannedExams: next });
                        }}
                        className={`px-2.5 py-1 rounded-lg font-bold border transition-all cursor-pointer ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {active ? '✓ ' : ''}{code}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time until exam */}
              <div className="lg:col-span-3 space-y-1">
                <label className="text-[11px] font-semibold text-slate-700 block">
                  Thời gian còn lại tới kỳ thi:
                </label>
                <select
                  value={currentTimeUntilExam === 'unknown' ? '' : currentTimeUntilExam}
                  onChange={e =>
                    applyProfilePatch({
                      timeUntilExam: (e.target.value || 'unknown') as ExamTimeframe
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
                >
                  <option value="">Chưa xác định rõ (Ước lượng)</option>
                  <option value="< 1 tháng">&lt; 1 tháng</option>
                  <option value="1–3 tháng">1–3 tháng</option>
                  <option value="3–6 tháng">3–6 tháng</option>
                  <option value="6–9 tháng">6–9 tháng</option>
                  <option value="> 9 tháng">&gt; 9 tháng</option>
                </select>
              </div>

              {/* Exam vs Skill Slider */}
              <div className="lg:col-span-4 space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-700">
                    Điều chỉnh tỷ lệ Ôn thi / Kỹ năng:
                  </label>
                  {activeRoadmap.allocation?.isUserAdjusted && (
                    <button
                      type="button"
                      onClick={() => applyProfilePatch({ customExamRatio: null })}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                    >
                      Đặt lại tự động
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={activeRoadmap.allocation?.examRatio ?? 70}
                    onChange={e => applyProfilePatch({ customExamRatio: Number(e.target.value) })}
                    className="flex-1 accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-[11px] font-bold text-slate-800 tabular-nums w-20 text-right">
                    {activeRoadmap.allocation?.examRatio ?? 70}% / {activeRoadmap.allocation?.skillRatio ?? 30}%
                  </span>
                </div>
              </div>
            </div>

            {/* Optional Weak Topics Input */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Chuyên đề yếu thực tế (tùy chọn — để trống nếu chưa đánh giá):
                </label>
                <input
                  type="text"
                  value={currentWeakTopicsText}
                  onChange={e => applyProfilePatch({ weakTopicsText: e.target.value })}
                  placeholder="Ví dụ: Hình không gian, Đọc hiểu Tiếng Anh (cách bởi dấu phẩy)"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                />
              </div>
              {activeRoadmap.allocation?.rationale && (
                <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 text-[11px] text-slate-600 leading-relaxed">
                  <strong className="text-slate-800">Cơ sở phân bổ:</strong> {activeRoadmap.allocation.rationale}
                </div>
              )}
            </div>
          </div>
        )}

        {/* View Switcher + AI Refinement Action */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 flex-wrap gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setViewTab('roadmap')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                viewTab === 'roadmap'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Lộ trình Hành động ({activeRoadmap.phases.length} giai đoạn)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewTab('skillgap')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                viewTab === 'skillgap'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>
                Lỗ hổng Kỹ năng ({skillGap.strongSkills.length + skillGap.developingSkills.length + skillGap.missingSkills.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewTab('aiOutlook')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                viewTab === 'aiOutlook'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Tác động AI & Xu hướng 3–5 năm</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 tabular-nums">
              Sẵn sàng kỹ năng: <strong className="text-emerald-700">{skillGap.overallReadiness}%</strong>
            </span>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={handleRefineWithAI}
              disabled={isRefiningAI}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {isRefiningAI ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang tinh chỉnh AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Tinh chỉnh lộ trình bằng AI</span>
                </>
              )}
            </button>
            {aiRefinedRoadmap && (
              <button
                type="button"
                onClick={handleResetToEngine}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                title="Quay lại lộ trình chuẩn từ Engine"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Bản Engine chuẩn</span>
              </button>
            )}
          </div>
        </div>

        {/* Source attribution & Tailored Note */}
        <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-950 space-y-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="font-bold text-indigo-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>
                Nguồn lộ trình:{' '}
                {activeRoadmap.source === 'ai-hybrid'
                  ? `Hybrid AI (${activeRoadmap.modelUsed || 'Gemini / Local AI'})`
                  : 'Engine chuẩn hóa'}
              </span>
            </span>
            {activeRoadmap.isTimelineEstimated && (
              <span className="text-[11px] font-semibold text-amber-800">
                Mốc thời gian đang ước lượng (chưa có ngày thi cụ thể)
              </span>
            )}
          </div>
          <p className="leading-relaxed">{activeRoadmap.tailoredNote}</p>
          {aiNotice && (
            <p className="text-[11px] text-amber-800 font-medium pt-1 border-t border-indigo-200/60">
              {aiNotice}
            </p>
          )}
          {activeRoadmap.validationWarnings && activeRoadmap.validationWarnings.length > 0 && (
            <div className="text-[11px] text-amber-900 pt-1 border-t border-indigo-200/60 space-y-0.5">
              {activeRoadmap.validationWarnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* VIEW 1: PHASED ROADMAP */}
      {viewTab === 'roadmap' && (
        <div className="space-y-5">
          {activeRoadmap.phases.map((phase, idx) => {
            const isPreExam = phase.stageCategory === 'pre-exam';
            const isPostExam = phase.stageCategory === 'post-exam';
            return (
              <div
                key={idx}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden"
              >
                {/* Phase Header */}
                <div className="p-5 bg-slate-50/80 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center space-x-3">
                    <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-extrabold text-xs flex items-center justify-center shrink-0 tabular-nums">
                      0{phase.phaseNumber}
                    </span>
                    <div>
                      <h3 className="font-extrabold text-slate-900 text-sm">{phase.name}</h3>
                      <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                        {phase.duration}
                        {phase.examFocus && phase.examFocus.length > 0
                          ? ` · Kỳ thi: ${phase.examFocus.join(', ')}`
                          : ''}
                        {isPreExam
                          ? ' · Giai đoạn Trước kỳ thi'
                          : isPostExam
                          ? ' · Giai đoạn Sau kỳ thi'
                          : ''}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Objectives & Skill Separation (Foundational vs Specialized) */}
                  <div className="grid md:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-100 space-y-2">
                      <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Mục tiêu trọng tâm</span>
                      </h4>
                      <ul className="space-y-1.5 text-slate-700 text-[11px]">
                        {phase.objectives.map((obj, i) => (
                          <li key={i} className="flex items-start space-x-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
                            <span>{obj}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Foundational vs Specialized Skills Separation */}
                    <div className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-100 space-y-2.5">
                      <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Phân tách Kỹ năng Nền tảng vs Chuyên ngành</span>
                      </h4>
                      {phase.foundationalSkills && phase.foundationalSkills.length > 0 && (
                        <div className="text-[11px] text-slate-700">
                          <span className="font-semibold text-emerald-800">Kỹ năng nền tảng: </span>
                          <span>{phase.foundationalSkills.join(' · ')}</span>
                        </div>
                      )}
                      {phase.specializedSkills && phase.specializedSkills.length > 0 ? (
                        <div className="text-[11px] text-slate-700">
                          <span className="font-semibold text-indigo-800">Kỹ năng chuyên ngành: </span>
                          <span>{phase.specializedSkills.join(' · ')}</span>
                        </div>
                      ) : isPreExam ? (
                        <div className="text-[11px] text-slate-500 italic">
                          Kỹ năng chuyên ngành (lập trình sâu, framework, đồ án lớn) được chuyển sang giai đoạn Sau kỳ thi để tránh quá tải.
                        </div>
                      ) : null}
                      {phase.projects.length > 0 && (
                        <div className="pt-1.5 border-t border-slate-200/70 text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-800">Hoạt động / Đầu ra: </span>
                          {phase.projects.join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 6-Field Personalized Study Tasks */}
                  {phase.studyTasks && phase.studyTasks.length > 0 && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <ClipboardCheck className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Nhiệm vụ Học tập & Ôn luyện Chi tiết (6 chiều)</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {phase.studyTasks.map((task, tIdx) => (
                          <div
                            key={tIdx}
                            className="p-3.5 rounded-xl bg-slate-50/90 border border-slate-200/80 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 pb-1.5">
                              <span className="font-bold text-slate-900">{task.subjectOrCompetency}</span>
                              <span className="text-[11px] font-semibold text-indigo-700 tabular-nums shrink-0">
                                {task.estimatedDuration}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-700">
                              <strong className="text-slate-800">Chuyên đề trọng tâm:</strong>{' '}
                              <span className={task.hasTopicDiagnostic ? '' : 'text-amber-800'}>
                                {task.topicFocus}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-700">
                              <strong className="text-slate-800">Mục tiêu:</strong> {task.specificGoal}
                            </div>
                            <div className="text-[11px] text-slate-700">
                              <strong className="text-slate-800">Phương pháp:</strong> {task.studyMethod}
                            </div>
                            <div className="text-[11px] text-emerald-900 bg-emerald-50/70 p-2 rounded-lg border border-emerald-200/70">
                              <strong>Kiểm chứng:</strong> {task.verificationMethod}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step-by-Step Chain for Skills */}
                  {phase.actionSteps && phase.actionSteps.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Chuỗi Chuyển hóa Năng lực</span>
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Lỗ hổng ➔ Khái niệm ➔ Thực hành ➔ Ứng dụng ➔ Cột mốc
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {phase.actionSteps.map((step, sIdx) => (
                          <div
                            key={sIdx}
                            className="p-3.5 bg-slate-50/90 rounded-xl border border-slate-200/90 text-xs space-y-2"
                          >
                            <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200/80 pb-1.5">
                              <span className="font-extrabold text-slate-900">{step.skill}</span>
                              <span className="text-[11px] text-slate-600 font-medium">
                                {step.currentStatus === 'Strong'
                                  ? 'Đã thành thạo'
                                  : step.currentStatus === 'Developing'
                                  ? 'Đang phát triển'
                                  : 'Còn thiếu'}{' '}
                                · {step.requiredLevel}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200/80 space-y-1">
                                <span className="text-[10px] font-bold text-indigo-700 uppercase flex items-center gap-1">
                                  <Lightbulb className="w-3 h-3 text-indigo-500" />
                                  1. Khái niệm
                                </span>
                                <p className="text-[11px] text-slate-700 leading-snug">{step.learningConcept}</p>
                              </div>
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200/80 space-y-1">
                                <span className="text-[10px] font-bold text-blue-700 uppercase flex items-center gap-1">
                                  <Code2 className="w-3 h-3 text-blue-500" />
                                  2. Bài tập nhỏ
                                </span>
                                <ul className="text-[11px] text-slate-700 space-y-0.5 leading-snug">
                                  {step.smallExercises.map((ex, ei) => (
                                    <li key={ei}>• {ex}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200/80 space-y-1">
                                <span className="text-[10px] font-bold text-purple-700 uppercase flex items-center gap-1">
                                  <FolderGit2 className="w-3 h-3 text-purple-500" />
                                  3. Dự án / Áp dụng
                                </span>
                                <p className="text-[11px] text-slate-700 leading-snug">{step.miniProject}</p>
                              </div>
                              <div className="p-2.5 bg-emerald-50/70 rounded-lg border border-emerald-200 space-y-1">
                                <span className="text-[10px] font-bold text-emerald-800 uppercase flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                                  4. Cột mốc
                                </span>
                                <p className="text-[11px] text-emerald-950 font-medium leading-snug">
                                  {step.milestoneGoal}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Phase Milestone Footer */}
                <div className="px-5 py-3.5 bg-emerald-50/70 border-t border-emerald-100 flex items-start space-x-2 text-xs">
                  <Target className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-emerald-950 leading-relaxed font-medium">
                    <strong>Cột mốc giai đoạn:</strong> {phase.milestone}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: SKILL GAP BREAKDOWN */}
      {viewTab === 'skillgap' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500 font-semibold mr-1">Trạng thái:</span>
              <button
                type="button"
                onClick={() => setSkillFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  skillFilter === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Tất cả ({skillGap.missingSkills.length + skillGap.developingSkills.length + skillGap.strongSkills.length})
              </button>
              <button
                type="button"
                onClick={() => setSkillFilter('missing')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  skillFilter === 'missing'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                Còn thiếu ({skillGap.missingSkills.length})
              </button>
              <button
                type="button"
                onClick={() => setSkillFilter('developing')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  skillFilter === 'developing'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                Đang phát triển ({skillGap.developingSkills.length})
              </button>
              <button
                type="button"
                onClick={() => setSkillFilter('strong')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  skillFilter === 'strong'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                Đã thành thạo ({skillGap.strongSkills.length})
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredSkills.map((item, idx) => (
              <div
                key={idx}
                className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between flex-wrap gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-base font-extrabold text-slate-900">{item.skill}</h4>
                    <p className="text-xs text-slate-600 mt-1">
                      <strong>Lý do bắt buộc:</strong> {item.reason || `Yêu cầu quan trọng của nghề ${selectedCareer.title}.`}
                    </p>
                  </div>
                  <div className="text-xs font-semibold text-slate-600">
                    {item.userLevel === 'Strong'
                      ? 'Đã thành thạo'
                      : item.userLevel === 'Developing'
                      ? 'Đang phát triển'
                      : 'Còn thiếu'}{' '}
                    · {item.requiredLevel || 'Cốt lõi bắt buộc'}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-700 uppercase flex items-center gap-1">
                      <Target className="w-3.5 h-3.5 text-indigo-600" />
                      Khoảng cách & Phương pháp học
                    </span>
                    <p className="text-slate-600 text-[11px] italic">{item.gap}</p>
                    <p className="text-slate-800 text-[11px] font-medium pt-1 border-t border-slate-200/60 leading-relaxed">
                      {item.improvementMethod}
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 space-y-1">
                    <span className="text-[10px] font-bold text-blue-800 uppercase flex items-center gap-1">
                      <Code2 className="w-3.5 h-3.5 text-blue-600" />
                      Bài tập Thực hành Đề xuất
                    </span>
                    <p className="text-blue-950 text-[11px] leading-relaxed">{item.suggestedPractice}</p>
                  </div>
                  <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-100 space-y-1">
                    <span className="text-[10px] font-bold text-purple-800 uppercase flex items-center gap-1">
                      <FolderGit2 className="w-3.5 h-3.5 text-purple-600" />
                      Dự án Thực chiến Đề xuất
                    </span>
                    <p className="text-purple-950 text-[11px] leading-relaxed">{item.suggestedProject}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 3: AI IMPACT & 3–5 YEAR FUTURE OUTLOOK */}
      {viewTab === 'aiOutlook' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="font-extrabold text-slate-900 text-base">
              Phân tích Tác động AI & Triển vọng 3–5 năm: {getCareerTitle(selectedCareer.id, selectedCareer.title)}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Khung thời gian định hướng: <strong>3–5 năm</strong> · Dựa trên CSDL nghề nghiệp chuẩn hóa và hồ sơ cá nhân của bạn
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2 text-xs">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <Bot className="w-4 h-4 text-indigo-600" />
                <span>1. Tự động hóa & Tác vụ AI hỗ trợ</span>
              </div>
              {aiOutlook.aiAutomation.hasData ? (
                <p className="text-slate-700 leading-relaxed">{aiOutlook.aiAutomation.automatedAspectsSummary}</p>
              ) : (
                <span className="text-slate-400 italic">Dữ liệu tự động hóa chưa có trong hệ thống</span>
              )}
            </div>

            <div className="p-4 rounded-xl bg-amber-50/40 border border-amber-200/70 space-y-2 text-xs">
              <div className="font-bold text-amber-950 flex items-center gap-1.5">
                <Brain className="w-4 h-4 text-amber-700" />
                <span>2. Thế mạnh Con người (Khó bị thay thế)</span>
              </div>
              <p className="text-amber-900 leading-relaxed">{aiOutlook.humanAdvantage.irreplaceableAspectsSummary}</p>
            </div>

            <div className="p-4 rounded-xl bg-blue-50/40 border border-blue-200/70 space-y-2 text-xs">
              <div className="font-bold text-blue-950 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <span>3. Nhu cầu Kỹ năng mới trong 3–5 năm</span>
              </div>
              <p className="text-blue-900 leading-relaxed">{aiOutlook.skillDemand.marketTrendSummary}</p>
            </div>

            <div className="p-4 rounded-xl bg-indigo-50/40 border border-indigo-200/70 space-y-2 text-xs">
              <div className="font-bold text-indigo-950 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-indigo-600" />
                <span>4. Học sinh nên chuẩn bị gì</span>
              </div>
              <ul className="text-indigo-950 space-y-1">
                {aiOutlook.preparation.tailoredAdvice.map((adv, idx) => (
                  <li key={idx}>• {adv}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center space-x-2 font-bold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-slate-700" />
              <span>5. Phân định Căn cứ Dữ liệu & Tính Bất định Tương lai</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                <span className="font-bold text-emerald-800 uppercase block text-[10px]">Dữ liệu xác thực (Known)</span>
                <ul className="text-slate-600 space-y-0.5 list-disc list-inside">
                  {aiOutlook.groundingAndUncertainty.knownData.map((kd, idx) => (
                    <li key={idx}>{kd}</li>
                  ))}
                </ul>
              </div>
              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                <span className="font-bold text-indigo-800 uppercase block text-[10px]">Suy luận (Inference)</span>
                <ul className="text-slate-600 space-y-0.5 list-disc list-inside">
                  {aiOutlook.groundingAndUncertainty.inferences.map((inf, idx) => (
                    <li key={idx}>{inf}</li>
                  ))}
                </ul>
              </div>
              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                <span className="font-bold text-amber-800 uppercase block text-[10px]">Bất định 3–5 năm (Uncertainty)</span>
                <ul className="text-slate-600 space-y-0.5 list-disc list-inside">
                  {aiOutlook.groundingAndUncertainty.uncertainties.map((unc, idx) => (
                    <li key={idx}>{unc}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-amber-900">{aiOutlook.groundingAndUncertainty.disclaimer}</p>
          </div>
        </div>
      )}
    </div>
  );
};
