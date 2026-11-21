/**
 * Core Data Models & TypeScript Types for EduPath AI Career Guidance Platform
 */

export type AgeGroup = '6-10' | '7-10' | '11-14' | '15-18' | '19-24' | '25-35' | '35+' | '25+';

export interface AgeGroupMeta {
  key: AgeGroup;
  labelVi: string;
  labelEn: string;
  stageVi: string;
  descriptionVi: string;
  badgeColor: string;
}

export type RIASECDimension = 'R' | 'I' | 'A' | 'S' | 'E' | 'C';

export interface RIASECScores {
  [key: string]: number;
  R: number; // 0 to 1
  I: number;
  A: number;
  S: number;
  E: number;
  C: number;
}

export interface RIASECResult {
  scores: RIASECScores;
  primary: RIASECDimension;
  secondary: RIASECDimension;
  tertiary: RIASECDimension;
  code: string; // e.g., "IRC"
  confidence: number; // 0 to 1
  description: string;
}

export interface MBTIResult {
  type: string; // e.g. "INTJ", "ENFP"
  confidence: number; // 0 to 1
  traits: {
    IE: 'I' | 'E';
    SN: 'S' | 'N';
    TF: 'T' | 'F';
    JP: 'J' | 'P';
  };
  notes: string;
}

export type SkillLevel = 'Beginner' | 'Developing' | 'Strong' | 'Expert';

export interface SelfRatedSkill {
  skill: string;
  level: SkillLevel;
  category: 'Technical' | 'Soft' | 'Domain';
}

export type PlannedExamCode = 'THPT' | 'HSA' | 'V-ACT' | 'TSA';

export type ExamTimeframe = '< 1 tháng' | '1–3 tháng' | '3–6 tháng' | '6–9 tháng' | '> 9 tháng' | 'unknown';

/**
 * Official THPT Graduation Exam Structure (2025+, Circular 24/2024/TT-BGDĐT):
 * 2 compulsory subjects (Toán học, Ngữ văn) + 2 elective subjects.
 */
export const THPT_COMPULSORY_SUBJECTS = ['Toán học', 'Ngữ văn'] as const;

export const THPT_ELECTIVE_SUBJECTS = [
  'Vật lý',
  'Hóa học',
  'Sinh học',
  'Lịch sử',
  'Địa lý',
  'Giáo dục kinh tế và pháp luật',
  'Tin học',
  'Công nghệ (Công nghiệp / Nông nghiệp)',
  'Tiếng Anh',
  'Ngoại ngữ khác'
] as const;

export interface ThptGraduationSubjects {
  compulsory: string[];
  electives: string[];
}

export interface ExamTimelineEntry {
  timeframe?: ExamTimeframe;
  targetDate?: string;
  isPrimary?: boolean;
}

export interface ExamProfile {
  hsaScore?: number; // HSA ĐHQG Hà Nội (thang 150)
  vactScore?: number; // V-ACT ĐHQG TP.HCM (thang 1200)
  tsaScore?: number; // TSA Bách Khoa Hà Nội (thang 100)
  pedagogyScore?: number; // Đánh giá năng lực Sư phạm (thang 100)
  thptAdmissionCombo?: string; // Tổ hợp xét tuyển Đại học (A00, A01, B00, C00, D01, ...)
  /** @deprecated Legacy alias for university admission combination; kept for backward compatibility */
  thptCombo?: string;
  thptGraduationSubjects?: ThptGraduationSubjects; // 2 môn bắt buộc (Toán, Văn) + 2 môn tự chọn thi tốt nghiệp THPT
  thptScore?: number; // Điểm thi THPT QG ước tính hoặc thực tế (thang 30)
  awards?: string[]; // Chứng chỉ / Giải thưởng (IELTS, HSG, KHKT...)
  plannedExams?: PlannedExamCode[]; // Chỉ các kỳ thi học sinh thực sự dự định tham gia
  timeUntilExam?: ExamTimeframe; // Mốc thời gian chung (fallback khi chưa đặt riêng theo từng kỳ thi)
  examTimelines?: Partial<Record<PlannedExamCode, ExamTimelineEntry>>; // Mốc thời gian riêng cho từng kỳ thi
  primaryExam?: PlannedExamCode; // Kỳ thi ưu tiên chính khi lịch học hạn chế
  studyGoal?: string; // Mục tiêu học tập / xét tuyển (VD: "Đạt 26+ khối A01", "Nâng nền tảng Toán")
  weakTopics?: string[]; // Chuyên đề yếu thực tế do học sinh tự khai báo hoặc từ đánh giá
  customExamRatio?: number; // Tỷ lệ % ôn thi do người dùng tự điều chỉnh (0-100)
}

export type CanonicalLLMProvider = 'gemini' | 'ollama' | 'offline-engine';
export type LLMProviderType = CanonicalLLMProvider | 'local' | 'custom';

export function normalizeLLMProvider(provider?: string): CanonicalLLMProvider {
  if (provider === 'offline-engine' || provider === 'local') return 'offline-engine';
  if (provider === 'ollama' || provider === 'custom') return 'ollama';
  return 'gemini';
}

export interface LLMConfig {
  provider: LLMProviderType;
  modelName: string;
  customEndpoint?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
  systemPromptStyle?: 'empathetic' | 'analytical' | 'strategic' | 'balanced';
  connectionStatus?: 'unknown' | 'connected' | 'error';
  lastPingMs?: number;
}

export interface UserProfile {
  id: string;
  name: string;
  age: number;
  gender?: 'Nam' | 'Nữ' | 'Khác';
  province?: string;
  grade?: string; // Lớp 10, Lớp 11, Lớp 12, Đại học, Tốt nghiệp/Đi làm
  ageGroup: AgeGroup;
  educationLevel: string;
  location?: string;
  favoriteSubjects: string[];
  confidentSubjects?: string[]; // Môn học tự tin điểm cao nhất
  academicGPA?: string; // Học lực / Điểm trung bình cả năm (Giỏi >8.0, Khá, etc.)
  interests: string[];
  strengths?: string[]; // Sở trường
  skills: string[];
  selfRatedSkills: SelfRatedSkill[];
  goals: string[];
  preferredWorkEnvironment: string[];
  preferredActivities: string[];
  careerPriorities: string[];
  careerReadiness?: 'clear' | 'undecided' | 'considering' | 'exploring'; // Trạng thái định hướng nghề
  interestedMajorInput?: string; // Các ngành người dùng tự nhập quan tâm
  examScores?: ExamProfile; // Các kỳ thi HSA, V-ACT, TSA, Sư phạm, THPT
  workPreferences: {
    teamworkVsSolo: 'Team' | 'Solo' | 'Balanced';
    handsOnVsAbstract: 'Hands-on' | 'Theoretical' | 'Balanced';
    remotePreference: 'Remote' | 'On-site' | 'Hybrid' | 'Any';
    creativityVsStructure: 'Creative' | 'Structured' | 'Balanced';
  };
  constraints: string[];
  educationPreferences: string[]; // e.g., "University", "Vocational", "Apprenticeship", "Self-Taught"
  financialConsiderations?: string;
  riaSecScores: RIASECScores;
  riaSecProfile: RIASECResult;
  mbtiType?: string;
  mbtiResult?: MBTIResult;
  assessmentConfidence: number; // 0 to 1
  completenessPercentage: number; // 0 to 100
  previousExperience?: string[];
  currentOccupation?: string;
  targetOccupation?: string;
  currentEducation?: string;
  targetEducation?: string;
  availableStudyTimeHoursPerWeek?: number;
  learningStyle?: 'Visual' | 'Hands-on' | 'Reading' | 'Social';
  personalityNotes?: string;
  assessmentTimestamp: number;
  version: string;
}

export interface CareerExperiment {
  title: string;
  duration: string;
  difficulty: 'Beginner' | 'Intermediate';
  description: string;
  steps: string[];
  expectedOutcome: string;
  evaluationQuestion?: string;
}

export interface Career {
  id: string;
  title: string;
  hollandCode?: string;
  aliases: string[];
  description: string;
  careerCluster: string;
  industry: string;
  tasks: string[];
  responsibilities: string[];
  workEnvironment: string[];
  requiredSkills: string[];
  recommendedSkills: string[];
  softSkills: string[];
  technicalSkills: string[];
  relevantSubjects: string[];
  relevantInterests: string[];
  riaSecProfile: RIASECScores;
  mbtiCompatibility: string[]; // Supplementary MBTI types
  educationPaths: Array<{
    type: 'University' | 'College/Vocational' | 'Self-Taught / Portfolio' | 'Certifications' | 'Apprenticeship';
    duration: string;
    description: string;
    tradeoffs: string;
  }>;
  relatedMajors: string[];
  vocationalPaths: string[];
  certifications: string[];
  portfolioExamples: string[];
  beginnerProjects: string[];
  progressionPath: {
    entry: string;
    mid: string;
    senior: string;
  };
  workStyle: string;
  challenges: string[];
  advantages: string[];
  futureTrends: string;
  aiImpact?: string;
  salaryInfo: {
    rangeDescription: string;
    disclaimer: string; // "Example / illustrative information - requires local verification"
    levelIndicator: 'Moderate' | 'Above Average' | 'High' | 'Very High';
  };
  experiments: CareerExperiment[];
  alternativeCareers: Array<{
    careerId: string;
    title: string;
    similarityReason: string;
    distinction: string;
  }>;
  source: string;
  lastUpdated: string;
}

export interface CareerCluster {
  id: string;
  name: string;
  description: string;
  iconName: string;
  careerCount: number;
  domain: string;
}

export interface ScoreBreakdown {
  riasec: number; // 0 to 100 (30% weight)
  academic: number; // 0 to 100 (30% weight - Học tập & điểm thi)
  skills: number; // 0 to 100 (25% weight - Kỹ năng)
  mbti: number; // 0 to 100 (5% weight - Phong cách MBTI bổ trợ)
  expectation: number; // 0 to 100 (10% weight - Kỳ vọng & môi trường)
  // Optional backwards compatibility fields
  interests?: number;
  subjects?: number;
  goals?: number;
  preferences?: number;
}

export interface RecommendationScore {
  careerId: string;
  career: Career;
  overallScore: number; // 0 to 100
  confidence: 'High' | 'Medium' | 'Low';
  confidenceReason: string;
  breakdown: ScoreBreakdown;
  positiveContributors: string[];
  negativeContributors: string[];
  missingSkills: string[];
  rank: number;
  recommendedPathway?: 'University' | 'VocationalCollege' | 'CertificationAndWork' | 'Flexible';
  pathwayAdvice?: string;
}

export interface ScoringWeights {
  wRIASEC: number; // 0.30
  wAcademic: number; // 0.30
  wSkills: number; // 0.25
  wMBTI: number; // 0.05
  wExpectation: number; // 0.10
  // Optional backwards compatibility fields
  wInterests?: number;
  wSubjects?: number;
  wGoals?: number;
  wPreferences?: number;
}

export interface SkillGapItem {
  skill: string;
  userLevel: 'Strong' | 'Developing' | 'Missing';
  priority: 'High' | 'Medium' | 'Low';
  category: 'Technical' | 'Soft' | 'Domain';
  recommendedAction: string;
  // Extended structured dimensions
  currentStatus?: 'Strong' | 'Developing' | 'Missing';
  requiredLevel?: string;
  gap?: string;
  reason?: string;
  improvementMethod?: string;
  suggestedPractice?: string;
  suggestedProject?: string;
}

export interface SkillGapAnalysis {
  careerId: string;
  careerTitle: string;
  overallReadiness: number; // 0 to 100
  strongSkills: SkillGapItem[];
  developingSkills: SkillGapItem[];
  missingSkills: SkillGapItem[];
  highPriorityCount: number;
}

export interface RoadmapMilestoneStep {
  skill: string;
  currentStatus: 'Strong' | 'Developing' | 'Missing';
  requiredLevel: string;
  gap: string;
  priority: 'High' | 'Medium' | 'Low';
  learningConcept: string;
  smallExercises: string[];
  miniProject: string;
  milestoneGoal: string;
}

export interface StudyTaskItem {
  subjectOrCompetency: string; // (1) Môn học / Năng lực mục tiêu
  topicFocus: string; // (2) Chuyên đề trọng tâm (hoặc nêu rõ chưa có dữ liệu chuyên đề yếu)
  hasTopicDiagnostic: boolean; // True nếu lấy từ dữ liệu thực của học sinh
  specificGoal: string; // (3) Mục tiêu đầu ra cụ thể
  studyMethod: string; // (4) Phương pháp học / luyện đề / phân tích lỗi
  estimatedDuration: string; // (5) Thời lượng dự kiến
  verificationMethod: string; // (6) Cách kiểm chứng hoàn thành
  examCode?: PlannedExamCode;
  allocatedHours?: number;
  priority?: 'High' | 'Medium' | 'Low';
  examTimeframe?: ExamTimeframe;
  targetExamDate?: string;
  originalWeakTopics?: string[];
  aiSuggestionNote?: string;
  allocationTradeoffNote?: string;
}

export interface RoadmapPhase {
  phaseNumber: number;
  name: string;
  duration: string;
  timeframe?: '0–3 months' | '3–6 months' | '6–12 months' | string;
  stageCategory?: 'pre-exam' | 'post-exam' | 'highschool-prep' | 'exploration' | 'career-specialization' | 'transition';
  examFocus?: PlannedExamCode[];
  objectives: string[];
  skillsToLearn: string[];
  foundationalSkills?: string[];
  specializedSkills?: string[];
  studyTasks?: StudyTaskItem[];
  projects: string[];
  recommendedActivities: string[];
  milestone: string;
  actionSteps?: RoadmapMilestoneStep[];
}

export interface ExamAllocationSummary {
  exam: PlannedExamCode;
  hours: number;
  timeframe: ExamTimeframe;
  targetDate?: string;
  isPrimary: boolean;
  rationale: string;
}

export interface RoadmapAIValidationStatus {
  jsonValid: boolean;
  schemaValid: boolean;
  contentAccepted: boolean;
  aiChangesApplied: boolean;
  fallbackUsed: boolean;
  rejectedReasons?: string[];
}

export interface LearningRoadmap {
  careerId: string;
  careerTitle: string;
  targetAgeGroup: AgeGroup;
  stageLabel?: string;
  gradeDetected?: string;
  suggestedGrade?: string;
  needsGradeConfirmation?: boolean;
  needsGraduationSubjectsConfirmation?: boolean;
  allocation?: {
    examRatio: number;
    skillRatio: number;
    examHoursPerWeek?: number;
    skillHoursPerWeek?: number;
    totalHoursPerWeek?: number;
    tradeoffWarning?: string;
    isDefault: boolean;
    isUserAdjusted?: boolean;
    rationale: string;
  };
  examAllocations?: ExamAllocationSummary[];
  needsExamConfirmation?: boolean;
  isTimelineEstimated?: boolean;
  plannedExams?: PlannedExamCode[];
  source?: 'engine' | 'ai-hybrid';
  modelUsed?: string;
  validationWarnings?: string[];
  aiValidationStatus?: RoadmapAIValidationStatus;
  phases: RoadmapPhase[];
  tailoredNote: string;
}

export interface AIImpactAnalysis {
  careerId: string;
  careerTitle: string;
  timeHorizon: '3–5 năm';
  aiAutomation: {
    hasData: boolean;
    directAiImpact?: string;
    assistableTasks: string[];
    automatedAspectsSummary: string;
  };
  humanAdvantage: {
    hasData: boolean;
    coreAbilities: string[];
    irreplaceableAspectsSummary: string;
  };
  skillDemand: {
    hasData: boolean;
    emergingSkills: string[];
    marketTrendSummary: string;
  };
  preparation: {
    hasData: boolean;
    tailoredAdvice: string[];
    keyFocusAreas: string[];
    progressionAdvice: string;
  };
  groundingAndUncertainty: {
    knownData: string[];
    inferences: string[];
    uncertainties: string[];
    disclaimer: string;
  };
}

export interface WhatIfAdjustments {
  addedSubjects: string[];
  removedSubjects: string[];
  addedSkills: string[];
  preferredRemote: 'Remote' | 'On-site' | 'Any';
  higherTeamwork: boolean;
  noUniversity: boolean;
  priorityHighIncome: boolean;
}

export interface WhatIfComparisonResult {
  beforeRankings: Array<{ careerId: string; title: string; score: number }>;
  afterRankings: Array<{ careerId: string; title: string; score: number; delta: number }>;
  explanation: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sources?: string[];
  suggestedQuestions?: string[];
}

export interface AssessmentQuestion {
  id: string;
  module: 'basic' | 'interests' | 'riasec' | 'skills' | 'subjects' | 'goals' | 'workStyle' | 'mbti';
  ageGroups: AgeGroup[];
  prompt: string;
  description?: string;
  type: 'single-choice' | 'multi-choice' | 'rating' | 'slider';
  options: Array<{
    label: string;
    value: string;
    emoji?: string;
    riasecWeight?: Partial<Record<RIASECDimension, number>>;
    skillTags?: string[];
    interestTags?: string[];
    subjectTags?: string[];
    mbtiWeight?: { dimension: 'IE' | 'SN' | 'TF' | 'JP'; value: 'I' | 'E' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P' };
  }>;
}

export interface DisambiguationQuestion {
  careerA: { id: string; title: string };
  careerB: { id: string; title: string };
  question: string;
  options: Array<{
    label: string;
    favorsCareerId: string;
    impactDescription: string;
  }>;
}

export function getHollandCode(scores: RIASECScores): string {
  const sorted = Object.entries(scores)
    .filter(([k]) => ['R', 'I', 'A', 'S', 'E', 'C'].includes(k))
    .sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 3).map(s => s[0]).join('');
}
