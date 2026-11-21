import {
  AgeGroup,
  Career,
  ExamTimeframe,
  LearningRoadmap,
  PlannedExamCode,
  RoadmapMilestoneStep,
  RoadmapPhase,
  SkillGapAnalysis,
  StudyTaskItem,
  UserProfile
} from '../types';
import { analyzeSkillGap } from './skillGapEngine';

/**
 * Helper: Maps THPT combo code (e.g. "A00 (Toán, Lý, Hóa)") to concrete subject labels
 * without ever guessing a combo when none was selected by the student.
 */
function parseThptComboSubjects(thptCombo?: string): string {
  if (!thptCombo || !thptCombo.trim()) {
    return 'Các môn trong tổ hợp xét tuyển THPT (chưa chọn khối thi cụ thể)';
  }
  const match = thptCombo.match(/\(([^)]+)\)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return thptCombo.trim();
}

/**
 * Helper: Normalizes AgeGroup legacy aliases ('7-10' -> '6-10', '25+' -> '25-35').
 */
function normalizeAgeGroup(ageGroup?: AgeGroup, age?: number): '6-10' | '11-14' | '15-18' | '19-24' | '25-35' | '35+' {
  if (ageGroup === '6-10' || ageGroup === '7-10') return '6-10';
  if (ageGroup === '11-14') return '11-14';
  if (ageGroup === '15-18') return '15-18';
  if (ageGroup === '19-24') return '19-24';
  if (ageGroup === '25-35' || ageGroup === '25+') return '25-35';
  if (ageGroup === '35+') return '35+';

  const n = Number(age || 17);
  if (n <= 10) return '6-10';
  if (n <= 14) return '11-14';
  if (n <= 18) return '15-18';
  if (n <= 24) return '19-24';
  if (n <= 35) return '25-35';
  return '35+';
}

/**
 * Detects high-school grade ('10' | '11' | '12') from explicit profile.grade or age when in 15-18.
 */
function detectHighSchoolGrade(profile: UserProfile): '10' | '11' | '12' {
  const g = (profile.grade || '').toLowerCase();
  if (g.includes('12')) return '12';
  if (g.includes('11')) return '11';
  if (g.includes('10')) return '10';
  const age = Number(profile.age || 0);
  if (age >= 18) return '12';
  if (age === 17) return '11';
  return '10';
}

/**
 * Computes flexible Exam vs. Foundational Skill allocation ratio for Grade 12
 * starting from 70% exam / 30% skill reference baseline.
 */
export function computeGrade12Allocation(
  profile: UserProfile,
  plannedExams: PlannedExamCode[],
  timeUntilExam: ExamTimeframe,
  hoursPerWeek: number
): NonNullable<LearningRoadmap['allocation']> {
  const custom = profile.examScores?.customExamRatio;
  if (typeof custom === 'number' && Number.isFinite(custom)) {
    const examRatio = Math.max(0, Math.min(100, Math.round(custom)));
    const skillRatio = 100 - examRatio;
    return {
      examRatio,
      skillRatio,
      isDefault: false,
      isUserAdjusted: true,
      rationale: `Tỷ lệ do học sinh tự điều chỉnh trực tiếp (${examRatio}% ôn thi / ${skillRatio}% kỹ năng nền tảng).`
    };
  }

  const hasBaselineScore = Boolean(
    profile.examScores?.thptScore ||
      profile.examScores?.hsaScore ||
      profile.examScores?.vactScore ||
      profile.examScores?.tsaScore ||
      profile.academicGPA
  );
  const hasTimeline = timeUntilExam !== 'unknown';
  const hasGoal = Boolean(profile.examScores?.studyGoal?.trim());

  if (!hasTimeline && !hasBaselineScore && plannedExams.length === 0 && !hasGoal) {
    return {
      examRatio: 70,
      skillRatio: 30,
      isDefault: true,
      isUserAdjusted: false,
      rationale:
        'Đây là phân bổ mặc định tham khảo (70% ôn thi / 30% kỹ năng nền tảng) do chưa đủ dữ liệu về thời điểm thi, kỳ thi dự định, điểm hiện tại và mục tiêu; học sinh có thể điều chỉnh lại tỷ lệ này.'
    };
  }

  let examRatio = 70;
  const reasons: string[] = ['Xuất phát từ mức tham chiếu 70% ôn thi / 30% kỹ năng nền tảng'];

  // 1. Time remaining adjustment
  if (timeUntilExam === '< 1 tháng') {
    examRatio += 20;
    reasons.push('tăng +20% ưu tiên ôn thi vì chỉ còn dưới 1 tháng tới kỳ thi');
  } else if (timeUntilExam === '1–3 tháng') {
    examRatio += 15;
    reasons.push('tăng +15% ưu tiên luyện đề vì còn 1–3 tháng');
  } else if (timeUntilExam === '3–6 tháng') {
    examRatio += 5;
    reasons.push('tăng +5% để giữ nhịp ôn tập cho chặng 3–6 tháng');
  } else if (timeUntilExam === '> 9 tháng') {
    examRatio -= 5;
    reasons.push('giảm -5% ôn thi cường độ cao vì quỹ thời gian còn trên 9 tháng');
  }

  // 2. Number of planned exams
  if (plannedExams.length >= 3) {
    examRatio += 10;
    reasons.push(`tăng +10% vì học sinh dự định tham gia ${plannedExams.length} kỳ thi khác nhau`);
  } else if (plannedExams.length === 2) {
    examRatio += 5;
    reasons.push('tăng +5% vì ôn tập song song 2 kỳ thi');
  }

  // 3. Current academic baseline
  const gpaStr = (profile.academicGPA || '').toLowerCase();
  if (gpaStr.includes('trung bình') || gpaStr.includes('khá')) {
    examRatio += 5;
    reasons.push('tăng +5% để củng cố kiến thức học lực hiện tại');
  } else if (gpaStr.includes('xuất sắc') && (timeUntilExam === '6–9 tháng' || timeUntilExam === '> 9 tháng')) {
    examRatio -= 5;
    reasons.push('giảm -5% vì nền tảng học lực Xuất sắc và còn nhiều thời gian');
  }

  // 4. Weekly study hours constraint
  if (hoursPerWeek <= 8 && (timeUntilExam === '< 1 tháng' || timeUntilExam === '1–3 tháng')) {
    examRatio += 5;
    reasons.push(`tăng +5% để tránh dàn trải khi quỹ tự học chỉ ${hoursPerWeek} giờ/tuần`);
  } else if (hoursPerWeek >= 18 && timeUntilExam === '> 9 tháng') {
    examRatio -= 5;
    reasons.push(`giảm -5% nhờ quỹ tự học dồi dào (${hoursPerWeek} giờ/tuần)`);
  }

  examRatio = Math.max(55, Math.min(90, examRatio));
  const skillRatio = 100 - examRatio;

  return {
    examRatio,
    skillRatio,
    isDefault: !hasTimeline || !hasBaselineScore,
    isUserAdjusted: false,
    rationale: `${reasons.join('; ')}.`
  };
}

/**
 * Builds actionable milestone steps connecting:
 * Skill Gap → Learning Concept → Small Exercises → Mini Project → Milestone
 */
function buildMilestoneStepsForSkills(
  skills: Array<{
    skill: string;
    userLevel: 'Strong' | 'Developing' | 'Missing';
    requiredLevel?: string;
    gap?: string;
    priority: 'High' | 'Medium' | 'Low';
    category?: string;
  }>,
  career: Career,
  phaseType: 'foundation' | 'intermediate' | 'capstone' | 'foundational-study'
): RoadmapMilestoneStep[] {
  return skills.map(item => {
    const sName = item.skill;

    if (phaseType === 'foundational-study') {
      return {
        skill: sName,
        currentStatus: item.userLevel,
        requiredLevel: item.requiredLevel || 'Năng lực nền tảng hỗ trợ học tập',
        gap: item.gap || 'Cần duy trì nhịp độ rèn luyện nhẹ nhàng song song với ôn thi',
        priority: item.priority,
        learningConcept: `Rèn luyện tư duy và phương pháp nền tảng cho ${sName} phục vụ trực tiếp hiệu quả ôn tập và đọc hiểu tài liệu.`,
        smallExercises: [
          `Dành 20–30 phút/buổi thực hành ${sName} gắn với bài học hoặc đề luyện trên lớp.`,
          `Tổng hợp ghi chú súc tích các quy tắc/từ khóa quan trọng để tiết kiệm thời gian ôn lại.`
        ],
        miniProject: `Áp dụng ${sName} vào sổ tay ôn thi hoặc kế hoạch tự học hàng tuần (không làm dự án nặng trước kỳ thi).`,
        milestoneGoal: `Tăng tốc độ tiếp thu và giảm lỗi sai bất cẩn trong quá trình ôn thi mà không gây quá tải.`
      };
    }

    if (phaseType === 'foundation') {
      return {
        skill: sName,
        currentStatus: item.userLevel,
        requiredLevel: item.requiredLevel || 'Cốt lõi bắt buộc (Core Essential)',
        gap: item.gap || 'Khoảng cách lớn — Cần học từ nền tảng',
        priority: item.priority,
        learningConcept: `Nghiên cứu nguyên lý, thuật ngữ và cấu trúc vận hành cốt lõi của ${sName}.`,
        smallExercises: [
          `Hoàn thành 5–8 bài tập cơ bản để nắm chắc quy tắc vận hành của ${sName}.`,
          `Thực hành kiểm tra và ghi chú các lỗi phổ biến khi áp dụng ${sName}.`
        ],
        miniProject: `Xây dựng mini-project nhập môn giải quyết bài toán cơ bản ứng dụng ${sName}.`,
        milestoneGoal: `Vận hành thành công sản phẩm nhập môn đầu tay và tự kiểm tra đạt yêu cầu kiến thức nền tảng.`
      };
    }

    if (phaseType === 'intermediate') {
      return {
        skill: sName,
        currentStatus: item.userLevel,
        requiredLevel: item.requiredLevel || 'Kỹ thuật chuyên sâu (Technical Mastery)',
        gap: item.gap || 'Khoảng cách trung bình — Cần thực hành dự án tích hợp',
        priority: item.priority,
        learningConcept: `Học quy chuẩn thực hành, tối ưu hóa quy trình và phối hợp công cụ cho ${sName}.`,
        smallExercises: [
          `Giải 8–10 bài tập tình huống nâng cao có tiêu chí kiểm thử rõ ràng.`,
          `Đánh giá lại hiệu quả và cải thiện chất lượng đầu ra của ${sName}.`
        ],
        miniProject: `Xây dựng sản phẩm trung cấp tích hợp ${sName} vào bài toán thực tế của nghề ${career.title}.`,
        milestoneGoal: `Sản phẩm hoạt động ổn định, có tài liệu mô tả quy trình và giải pháp rõ ràng.`
      };
    }

    return {
      skill: sName,
      currentStatus: item.userLevel,
      requiredLevel: item.requiredLevel || 'Sẵn sàng ứng tuyển thực tế',
      gap: 'Chuyển hóa từ bài tập sang hồ sơ năng lực thực tế',
      priority: item.priority,
      learningConcept: `Quy trình hoàn thiện sản phẩm chuẩn chuyên nghiệp, kiểm thử và trình bày giải pháp cho ${sName}.`,
      smallExercises: [
        `Thực hiện bài toán tổng hợp gắn với bối cảnh doanh nghiệp trong ngành ${career.title}.`,
        `Luyện tập trình bày sản phẩm và trả lời câu hỏi phản biện chuyên môn.`
      ],
      miniProject:
        career.portfolioExamples?.[0] ||
        `Capstone Project mô phỏng sản phẩm thực tế của nghề ${career.title}`,
      milestoneGoal: `Hoàn thiện minh chứng năng lực (Portfolio/Dự án mẫu) sẵn sàng cho bậc học tiếp theo hoặc tuyển dụng.`
    };
  });
}

/**
 * Generates grounded 6-field StudyTaskItem entries for Grade 12 selected exams ONLY.
 * Strictly avoids fabricating weak topics or assuming unselected exams.
 */
function buildExamStudyTasks(
  profile: UserProfile,
  plannedExams: PlannedExamCode[],
  examHoursPerWeek: number,
  isSprintPhase: boolean
): StudyTaskItem[] {
  const weakTopics = (profile.examScores?.weakTopics || []).map(w => w.trim()).filter(Boolean);
  const hasTopicDiagnostic = weakTopics.length > 0;
  const studyGoal = profile.examScores?.studyGoal?.trim();

  if (plannedExams.length === 0) {
    return [
      {
        subjectOrCompetency: 'Xác nhận kỳ thi mục tiêu',
        topicFocus: hasTopicDiagnostic
          ? `Chuyên đề học sinh đã ghi nhận cần cải thiện: ${weakTopics.join(', ')}`
          : 'Chưa có dữ liệu kỳ thi dự định và chuyên đề yếu — Cần xác nhận trước khi lập lịch ôn chi tiết',
        hasTopicDiagnostic,
        specificGoal:
          'Xác nhận chính xác các kỳ thi thực tế sẽ tham gia (THPT, HSA, V-ACT, TSA) và làm bài kiểm tra đầu vào để xác định mặt bằng điểm.',
        studyMethod:
          'Chọn danh sách kỳ thi dự định, làm 1 đề tham khảo bấm giờ nghiêm túc cho từng kỳ thi đã chọn và thống kê các câu sai.',
        estimatedDuration: `${Math.max(2, Math.round(examHoursPerWeek))} giờ (tuần đầu xác nhận)`,
        verificationMethod:
          'Có danh sách kỳ thi đã chốt và bảng điểm chẩn đoán ban đầu kèm danh sách chuyên đề sai sót.'
      }
    ];
  }

  const perExamHours = Math.max(2, Math.round((examHoursPerWeek / plannedExams.length) * 10) / 10);
  const tasks: StudyTaskItem[] = [];

  for (const exam of plannedExams) {
    if (exam === 'THPT') {
      const subjectsStr = parseThptComboSubjects(profile.examScores?.thptCombo);
      const hasThptScore = typeof profile.examScores?.thptScore === 'number';
      tasks.push({
        subjectOrCompetency: `Kỳ thi THPT QG — ${subjectsStr}`,
        topicFocus: hasTopicDiagnostic
          ? `Ưu tiên chuyên đề học sinh khai báo cần cải thiện (${weakTopics.join(', ')}) trong ${subjectsStr}`
          : 'Chưa có dữ liệu chuyên đề yếu cụ thể — Làm 1 đề khảo sát tổng hợp để khoanh vùng dạng bài hay sai',
        hasTopicDiagnostic,
        specificGoal: hasThptScore
          ? `Cải thiện từ mốc ${profile.examScores?.thptScore}/30 hiện tại${studyGoal ? ` hướng tới mục tiêu: ${studyGoal}` : ', giảm lỗi sai ở câu vận dụng'}.`
          : `Thiết lập điểm nền thực tế cho ${subjectsStr}${studyGoal ? ` và bám sát mục tiêu: ${studyGoal}` : ', nắm vững 70–80% câu hỏi nhận biết – thông hiểu trước khi tăng tốc vận dụng'}.`,
        studyMethod: isSprintPhase
          ? 'Luyện đề chuẩn thời gian thực, lập sổ theo dõi lỗi sai theo dạng bài và ôn lại phần kiến thức mất điểm ngay sau mỗi đề.'
          : 'Hệ thống hóa kiến thức trọng tâm từng chương, kết hợp luyện đề từng phần và ghi chú các lỗi tính toán/đọc đề.',
        estimatedDuration: `${perExamHours} giờ/tuần`,
        verificationMethod: hasThptScore
          ? 'Hoàn thành 1–2 đề thi thử/tuần, đối chiếu đáp án và kiểm tra tỷ lệ lỗi lặp lại giảm dần qua từng tuần.'
          : 'Hoàn thành bài thi thử chẩn đoán đầu tiên để có điểm nền và lập danh sách chuyên đề cần vá.'
      });
    } else if (exam === 'HSA') {
      const hasHsa = typeof profile.examScores?.hsaScore === 'number';
      tasks.push({
        subjectOrCompetency: 'Kỳ thi ĐGNL ĐHQG Hà Nội (HSA)',
        topicFocus: hasTopicDiagnostic
          ? `Tập trung các nội dung liên quan tới: ${weakTopics.join(', ')} trong cấu trúc Định lượng / Định tính / Khoa học`
          : 'Chưa có dữ liệu chuyên đề yếu từng phần của HSA — Cần làm 1 đề mẫu đánh giá năng lực để xác định phần hụt điểm',
        hasTopicDiagnostic,
        specificGoal: hasHsa
          ? `Nâng cao độ chính xác và tốc độ xử lý bài thi từ mốc ${profile.examScores?.hsaScore}/150 hiện có.`
          : 'Xác định điểm nền HSA thực tế và làm quen áp lực thời gian giữa 3 phần thi Định lượng, Định tính và Khoa học/Tiếng Anh.',
        studyMethod: isSprintPhase
          ? 'Luyện đề bấm giờ trên máy tính mô phỏng cấu trúc HSA, rà soát kỹ các câu đọc hiểu dài và xử lý số liệu.'
          : 'Ôn chắc tư duy toán định lượng, kỹ năng đọc hiểu văn bản nhanh và phản xạ xử lý câu hỏi khoa học tổng hợp.',
        estimatedDuration: `${perExamHours} giờ/tuần`,
        verificationMethod: hasHsa
          ? 'Ghi lại điểm từng phần sau mỗi lần thi thử để kiểm tra phần yếu nhất có tiến triển.'
          : 'Hoàn thành 1 bài thi thử HSA chuẩn cấu trúc và phân tách điểm theo từng hợp phần.'
      });
    } else if (exam === 'V-ACT') {
      const hasVact = typeof profile.examScores?.vactScore === 'number';
      tasks.push({
        subjectOrCompetency: 'Kỳ thi ĐGNL ĐHQG TP.HCM (V-ACT)',
        topicFocus: hasTopicDiagnostic
          ? `Ưu tiên phần kiến thức cần củng cố: ${weakTopics.join(', ')} trong cấu trúc Ngôn ngữ / Logic / Giải quyết vấn đề`
          : 'Chưa có dữ liệu điểm thành phần V-ACT — Thực hiện đề thi thử để xác định phần cần bù đắp giữa Ngôn ngữ, Toán-Logic và Khoa học',
        hasTopicDiagnostic,
        specificGoal: hasVact
          ? `Tối ưu khả năng xử lý câu hỏi đọc hiểu và phân tích số liệu từ mức ${profile.examScores?.vactScore}/1200.`
          : 'Đo điểm nền V-ACT hiện tại và làm quen với tốc độ đọc – suy luận 120 câu trắc nghiệm.',
        studyMethod: isSprintPhase
          ? 'Luyện đề trọn vẹn 150 phút để rèn sức bền tập trung, phân tích nguyên nhân sai (thiếu kiến thức hay thiếu thời gian).'
          : 'Rèn kỹ năng đọc hiểu Tiếng Việt – Tiếng Anh, suy luận logic biểu đồ và hệ thống kiến thức giải quyết vấn đề.',
        estimatedDuration: `${perExamHours} giờ/tuần`,
        verificationMethod: hasVact
          ? 'Theo dõi số câu đúng trên tổng thời gian làm bài ở mỗi lần luyện đề.'
          : 'Có kết quả bài thi thử V-ACT đầu tiên và phân loại được nhóm câu hỏi sai.'
      });
    } else if (exam === 'TSA') {
      const hasTsa = typeof profile.examScores?.tsaScore === 'number';
      tasks.push({
        subjectOrCompetency: 'Kỳ thi ĐGTD ĐH Bách Khoa Hà Nội (TSA)',
        topicFocus: hasTopicDiagnostic
          ? `Gắn với chuyên đề học sinh cần cải thiện: ${weakTopics.join(', ')} ở phần Tư duy Toán học / Đọc hiểu / Khoa học`
          : 'Chưa có dữ liệu chuyên đề yếu TSA — Cần làm đề minh họa TSA để kiểm tra khả năng đọc hiểu khoa học và suy luận toán học',
        hasTopicDiagnostic,
        specificGoal: hasTsa
          ? `Cải thiện độ chính xác suy luận logic và đọc hiểu kỹ thuật từ mốc ${profile.examScores?.tsaScore}/100.`
          : 'Xác định mức điểm nền TSA và rèn phản xạ giải quyết câu hỏi suy luận không học thuộc lòng.',
        studyMethod: isSprintPhase
          ? 'Thực hành đề thi TSA trên máy, phân tích kỹ câu hỏi đọc hiểu biểu đồ – thí nghiệm và tối ưu phân bổ thời gian từng phần.'
          : 'Rèn tư duy toán học, kỹ năng phân tích văn bản khoa học – công nghệ và suy luận dựa trên dữ kiện cho sẵn.',
        estimatedDuration: `${perExamHours} giờ/tuần`,
        verificationMethod: hasTsa
          ? 'Đối chiếu tỷ lệ làm đúng các dạng câu kéo thả, đúng/sai và trắc nghiệm suy luận qua từng đề luyện.'
          : 'Hoàn thành 1 bài thi thử TSA có bấm giờ để xác định mặt bằng điểm thực tế.'
      });
    }
  }

  return tasks;
}

/**
 * Builds Grade 12 Exam-Timeline-Driven Hybrid Roadmap:
 * - Pre-exam phase(s): Exam prep priority (flexible ratio from 70/30 baseline) + ONLY foundational skills
 * - Post-exam phase: University transition & career specialized skills from SkillGapAnalysis
 */
function buildGrade12Roadmap(
  profile: UserProfile,
  career: Career,
  gap: SkillGapAnalysis,
  hoursPerWeek: number
): LearningRoadmap {
  const studentName = profile.name?.trim() || 'Học sinh';
  const plannedExams: PlannedExamCode[] = (profile.examScores?.plannedExams || []).filter(
    (e): e is PlannedExamCode => ['THPT', 'HSA', 'V-ACT', 'TSA'].includes(e)
  );
  const timeUntilExam: ExamTimeframe = profile.examScores?.timeUntilExam || 'unknown';
  const needsExamConfirmation = plannedExams.length === 0;
  const isTimelineEstimated = timeUntilExam === 'unknown';

  const allocation = computeGrade12Allocation(profile, plannedExams, timeUntilExam, hoursPerWeek);
  const examHours = Math.max(1, Math.round((hoursPerWeek * allocation.examRatio) / 100 * 10) / 10);
  const skillHours = Math.max(0.5, Math.round((hoursPerWeek * allocation.skillRatio) / 100 * 10) / 10);

  // Strict foundational skills ONLY during Pre-exam (NO React/frameworks/capstone/university domain overload)
  const foundationalSkillList = [
    'Quản lý thời gian & Sổ tay phân tích lỗi sai',
    'Tư duy logic & Đọc hiểu đề nhanh',
    'Ngoại ngữ học thuật (đọc hiểu từ vựng nền tảng)',
    'Tin học & Công cụ số phục vụ tự học'
  ];

  // Specialized career skills strictly reserved for Post-exam
  const postExamTargetSkills = [
    ...gap.missingSkills.filter(s => s.priority === 'High').slice(0, 3),
    ...gap.developingSkills.slice(0, 2)
  ].slice(0, 4);
  const fallbackSpecialized =
    postExamTargetSkills.length > 0
      ? postExamTargetSkills
      : (career.requiredSkills || []).slice(0, 3).map(s => ({
          skill: s,
          userLevel: 'Developing' as const,
          priority: 'Medium' as const,
          category: 'Technical' as const
        }));

  const specializedSkillNames = fallbackSpecialized.map(s => s.skill);
  const foundationalSteps = buildMilestoneStepsForSkills(
    foundationalSkillList.slice(0, 2).map(sk => ({
      skill: sk,
      userLevel: 'Developing' as const,
      priority: 'High' as const,
      category: 'Soft' as const
    })),
    career,
    'foundational-study'
  );

  const phases: RoadmapPhase[] = [];
  const isShortSprint = timeUntilExam === '< 1 tháng' || timeUntilExam === '1–3 tháng';
  const examsLabel =
    plannedExams.length > 0 ? plannedExams.join(', ') : 'Chưa xác nhận kỳ thi cụ thể';

  if (isShortSprint) {
    const durationLabel =
      timeUntilExam === '< 1 tháng'
        ? 'Trước kỳ thi (< 1 tháng cuối)'
        : 'Trước kỳ thi (1–3 tháng cuối)';

    const sprintTasks = buildExamStudyTasks(profile, plannedExams, examHours, true);
    sprintTasks.push({
      subjectOrCompetency: 'Kỹ năng nền tảng phục vụ thi cử',
      topicFocus: 'Kỹ luật phòng thi, phân bổ thời gian và giữ nhịp độ ôn tập ổn định',
      hasTopicDiagnostic: true,
      specificGoal: `Duy trì ${skillHours} giờ/tuần (${allocation.skillRatio}% quỹ thời gian) cho kỹ năng học tập, ngoại ngữ đọc hiểu và nghỉ ngơi hợp lý.`,
      studyMethod: 'Rèn kỹ năng đọc lướt đề, quản lý đồng hồ làm bài và ôn từ khóa ngoại ngữ nhẹ nhàng (không học kỹ năng chuyên ngành nặng).',
      estimatedDuration: `${skillHours} giờ/tuần`,
      verificationMethod: 'Hoàn thành các buổi luyện đề đúng thời gian quy định và duy trì sức khỏe ổn định.'
    });

    phases.push({
      phaseNumber: 1,
      name: `Giai đoạn Trước kỳ thi: Nước rút Ôn thi & Luyện đề (${examsLabel})`,
      duration: durationLabel,
      timeframe: durationLabel,
      stageCategory: 'pre-exam',
      examFocus: plannedExams,
      objectives: [
        needsExamConfirmation
          ? 'Xác nhận ngay các kỳ thi thực tế sẽ tham gia (THPT / HSA / V-ACT / TSA) và làm đề khảo sát đầu vào'
          : `Tập trung ${allocation.examRatio}% thời lượng (${examHours} giờ/tuần) ôn tập, luyện đề và phân tích lỗi sai cho: ${examsLabel}`,
        `Phân bổ ${allocation.skillRatio}% thời lượng (${skillHours} giờ/tuần) cho kỹ năng nền tảng (quản lý thời gian, đọc hiểu, tư duy logic) — KHÔNG đưa kiến thức chuyên ngành nặng vào giai đoạn nước rút`
      ],
      skillsToLearn: foundationalSkillList.slice(0, 3),
      foundationalSkills: foundationalSkillList.slice(0, 3),
      specializedSkills: [],
      studyTasks: sprintTasks,
      projects: [
        'Sổ tay tổng hợp lỗi sai & chiến thuật phân bổ thời gian làm bài cho các kỳ thi đã chọn'
      ],
      recommendedActivities: [
        'Thi thử bấm giờ đúng khung giờ thi thật',
        'Rà soát tiêu chí xét tuyển chính thức của ngành/trường mục tiêu (không tự đoán điểm chuẩn)'
      ],
      milestone: needsExamConfirmation
        ? 'Chốt danh sách kỳ thi tham gia và hoàn thành bài kiểm tra chẩn đoán mặt bằng điểm.'
        : `Ổn định phong độ làm đề, giảm lỗi sai lặp lại và sẵn sàng tâm lý cho ${examsLabel}.`,
      actionSteps: foundationalSteps
    });
  } else {
    const preDuration1 =
      timeUntilExam === '3–6 tháng'
        ? 'Trước kỳ thi — Chặng 1 (Khoảng 1.5–3 tháng đầu)'
        : timeUntilExam === '6–9 tháng'
        ? 'Trước kỳ thi — Chặng 1 (Khoảng 3–5 tháng đầu)'
        : timeUntilExam === '> 9 tháng'
        ? 'Trước kỳ thi — Chặng 1 (Nửa đầu năm học)'
        : 'Trước kỳ thi — Chặng 1 (Ước lượng — Chưa xác định ngày thi)';

    const preDuration2 =
      timeUntilExam === '3–6 tháng'
        ? 'Trước kỳ thi — Chặng 2 (1.5–3 tháng sát kỳ thi)'
        : timeUntilExam === '6–9 tháng'
        ? 'Trước kỳ thi — Chặng 2 (2–3 tháng sát kỳ thi)'
        : timeUntilExam === '> 9 tháng'
        ? 'Trước kỳ thi — Chặng 2 (Chặng tăng tốc trước kỳ thi)'
        : 'Trước kỳ thi — Chặng 2 (Nước rút — Tùy thuộc thời điểm thi thực tế)';

    const ch1Tasks = buildExamStudyTasks(profile, plannedExams, examHours, false);
    ch1Tasks.push({
      subjectOrCompetency: 'Kỹ năng nền tảng & Định hướng nhẹ',
      topicFocus: 'Tư duy logic, thói quen tự học và tiếng Anh học thuật',
      hasTopicDiagnostic: true,
      specificGoal: `Duy trì ${skillHours} giờ/tuần (${allocation.skillRatio}% quỹ thời gian) củng cố kỹ năng học tập và đọc tài liệu cơ bản.`,
      studyMethod: 'Ghi chép chủ động (Cornell/Mindmap), rèn từ vựng tiếng Anh đọc hiểu và tìm hiểu sơ lược cấu trúc ngành học ở mức định hướng.',
      estimatedDuration: `${skillHours} giờ/tuần`,
      verificationMethod: 'Duy trì đều lịch tự học hàng tuần mà không ảnh hưởng tới điểm trên lớp.'
    });

    const ch2Tasks = buildExamStudyTasks(profile, plannedExams, examHours, true);

    phases.push({
      phaseNumber: 1,
      name: `Giai đoạn Trước kỳ thi (Chặng 1): Hệ thống Kiến thức & Khắc phục Lỗ hổng (${examsLabel})`,
      duration: preDuration1,
      timeframe: preDuration1,
      stageCategory: 'pre-exam',
      examFocus: plannedExams,
      objectives: [
        needsExamConfirmation
          ? 'Xác nhận chính xác các kỳ thi dự định tham gia trước khi phân chia giờ ôn chi tiết'
          : `Ưu tiên ${allocation.examRatio}% quỹ tự học (${examHours}h/tuần) củng cố kiến thức trọng tâm cho: ${examsLabel}`,
        `Duy trì ${allocation.skillRatio}% (${skillHours}h/tuần) rèn kỹ năng học tập nền tảng, tư duy logic và ngoại ngữ học thuật`
      ],
      skillsToLearn: foundationalSkillList,
      foundationalSkills: foundationalSkillList,
      specializedSkills: [],
      studyTasks: ch1Tasks,
      projects: ['Hệ thống sơ đồ kiến thức trọng tâm & bảng theo dõi chuyên đề cần cải thiện'],
      recommendedActivities: [
        'Làm bài thi thử chẩn đoán nếu chưa có điểm nền chính thức',
        'Rèn luyện thói quen phân tích kỹ nguyên nhân mất điểm sau mỗi bài kiểm tra'
      ],
      milestone: 'Nắm chắc kiến thức nền các môn thi đã chọn và xác định rõ các chuyên đề cần ưu tiên vá.',
      actionSteps: foundationalSteps
    });

    phases.push({
      phaseNumber: 2,
      name: `Giai đoạn Trước kỳ thi (Chặng 2): Luyện đề Chuẩn hóa & Tối ưu Điểm số (${examsLabel})`,
      duration: preDuration2,
      timeframe: preDuration2,
      stageCategory: 'pre-exam',
      examFocus: plannedExams,
      objectives: [
        `Tăng cường luyện đề theo đúng cấu trúc của ${plannedExams.length > 0 ? examsLabel : 'các kỳ thi đã xác nhận'}`,
        'Phân tích lỗi sai theo từng dạng bài, tối ưu tốc độ xử lý và giữ ổn định tâm lý phòng thi'
      ],
      skillsToLearn: ['Phân tích lỗi sai khi làm đề', 'Quản lý thời gian phòng thi'],
      foundationalSkills: ['Phân tích lỗi sai khi làm đề', 'Quản lý thời gian phòng thi'],
      specializedSkills: [],
      studyTasks: ch2Tasks,
      projects: ['Nhật ký sửa lỗi sau mỗi đề thi thử & phương án sắp xếp thứ tự nguyện vọng an toàn'],
      recommendedActivities: [
        'Thi thử định kỳ theo đúng khung giờ quy định',
        'Theo dõi đề án tuyển sinh chính thức từ các trường mục tiêu'
      ],
      milestone: 'Đạt tính ổn định điểm số qua các lần thi thử và hoàn tất phương án xét tuyển an toàn.'
    });
  }

  // POST-EXAM PHASE (Always separated cleanly after exams)
  const postPhaseNum = phases.length + 1;
  const postSteps = buildMilestoneStepsForSkills(fallbackSpecialized, career, 'foundation');
  const postTasks: StudyTaskItem[] = [
    {
      subjectOrCompetency: `Chuẩn bị chuyên ngành ${career.title}`,
      topicFocus:
        specializedSkillNames.length > 0
          ? `Bù đắp khoảng trống kỹ năng từ Skill Gap: ${specializedSkillNames.join(', ')}`
          : `Kiến thức nhập môn ngành ${career.title}`,
      hasTopicDiagnostic: true,
      specificGoal: `Bắt đầu làm quen bài bản các kỹ năng chuyên ngành cho ${career.title} ngay sau khi hoàn tất thi cử.`,
      studyMethod: 'Học qua tài liệu nhập môn chính thống kết hợp làm 1 dự án nhỏ thực hành cá nhân.',
      estimatedDuration: `${hoursPerWeek} giờ/tuần (sau kỳ thi)`,
      verificationMethod: 'Hoàn thành ít nhất 1 sản phẩm/bài tập thực hành đầu tay trước khi nhập học.'
    },
    {
      subjectOrCompetency: 'Chuyển tiếp môi trường Đại học / Đào tạo nghề',
      topicFocus: 'Kỹ năng tự nghiên cứu, làm việc nhóm và lập kế hoạch học tập bậc cao',
      hasTopicDiagnostic: true,
      specificGoal: 'Làm quen chương trình đào tạo năm nhất, câu lạc bộ chuyên môn và phương pháp học chủ động.',
      studyMethod: 'Đọc đề cương học phần nhập môn và kết nối với sinh viên khóa trên / mentor ngành.',
      estimatedDuration: '3–4 giờ/tuần (sau kỳ thi)',
      verificationMethod: 'Có lộ trình học tập học kỳ 1 và danh mục công cụ học tập cần thiết.'
    }
  ];

  phases.push({
    phaseNumber: postPhaseNum,
    name: `Giai đoạn Sau kỳ thi: Chuyển tiếp Đại học & Khởi động Kỹ năng Chuyên ngành (${career.title})`,
    duration: 'Sau kỳ thi (Nghỉ hè trước nhập học — Năm nhất)',
    timeframe: 'Post-exam transition',
    stageCategory: 'post-exam',
    objectives: [
      `Khởi động lộ trình lấp đầy khoảng trống kỹ năng (Skill Gap — mức sẵn sàng hiện tại ${gap.overallReadiness}%) cho ${career.title}`,
      'Tìm hiểu môi trường đào tạo đại học/cao đẳng nghề, chương trình năm nhất và định hướng phát triển dài hạn'
    ],
    skillsToLearn: specializedSkillNames,
    foundationalSkills: ['Phương pháp học tập bậc Đại học/Cao đẳng', 'Kỹ năng tự nghiên cứu'],
    specializedSkills: specializedSkillNames,
    studyTasks: postTasks,
    projects: [
      career.experiments?.[0]?.title || `Thử nghiệm nhập môn ngành ${career.title}`,
      career.beginnerProjects?.[0] || `Mini-project khởi đầu cho ${career.title}`
    ],
    recommendedActivities: [
      'Hoàn tất thủ tục xác nhận nhập học chính thức',
      `Tham gia cộng đồng/CLB học thuật liên quan tới ${career.title}`
    ],
    milestone: `Sẵn sàng bước vào bậc học tiếp theo với nền tảng kỹ năng nhập môn cho ${career.title}.`,
    actionSteps: postSteps
  });

  const timelineNote = isTimelineEstimated
    ? 'Chưa có thông tin cụ thể về thời gian còn lại tới kỳ thi nên mốc thời gian đang để ở mức ước lượng.'
    : `Thời gian dự kiến còn ${timeUntilExam} tới kỳ thi mục tiêu.`;

  const examConfirmNote = needsExamConfirmation
    ? ' Bạn chưa xác nhận danh sách kỳ thi tham gia (THPT / HSA / V-ACT / TSA) — vui lòng chọn kỳ thi để nhận kế hoạch ôn luyện cụ thể cho từng bài thi.'
    : ` Lịch ôn tập chỉ tập trung vào các kỳ thi bạn đã chọn (${examsLabel}).`;

  const tailoredNote = `Lộ trình Lớp 12 cho ${studentName} (${hoursPerWeek} giờ tự học/tuần): Phân bổ ${allocation.examRatio}% ôn thi / ${allocation.skillRatio}% kỹ năng nền tảng ở giai đoạn Trước kỳ thi; sau kỳ thi mới chuyển sang kỹ năng chuyên ngành ${career.title}. ${timelineNote}${examConfirmNote}`;

  return {
    careerId: career.id,
    careerTitle: career.title,
    targetAgeGroup: '15-18',
    stageLabel: 'Lớp 12 — Lộ trình Theo Mốc Kỳ thi (Trước kỳ thi & Sau kỳ thi)',
    gradeDetected: 'Lớp 12',
    allocation,
    needsExamConfirmation,
    isTimelineEstimated,
    plannedExams,
    source: 'engine',
    phases,
    tailoredNote
  };
}

/**
 * Builds Grade 10 & Grade 11 high school preparation roadmaps
 * (Strong foundational study + combo exploration before Grade 12 exam sprint).
 */
function buildGrade10Or11Roadmap(
  profile: UserProfile,
  career: Career,
  gap: SkillGapAnalysis,
  hoursPerWeek: number,
  gradeNum: '10' | '11'
): LearningRoadmap {
  const studentName = profile.name?.trim() || 'Học sinh';
  const plannedExams = (profile.examScores?.plannedExams || []).filter(
    (e): e is PlannedExamCode => ['THPT', 'HSA', 'V-ACT', 'TSA'].includes(e)
  );
  const weakTopics = (profile.examScores?.weakTopics || []).map(w => w.trim()).filter(Boolean);
  const hasTopicDiagnostic = weakTopics.length > 0;
  const comboStr = parseThptComboSubjects(profile.examScores?.thptCombo);

  const isGrade11 = gradeNum === '11';
  const custom = profile.examScores?.customExamRatio;
  const examRatio =
    typeof custom === 'number' && Number.isFinite(custom)
      ? Math.max(0, Math.min(100, Math.round(custom)))
      : isGrade11
      ? 45
      : 30;
  const skillRatio = 100 - examRatio;

  const targetSkills = [...gap.missingSkills.slice(0, 2), ...gap.developingSkills.slice(0, 2)].slice(0, 3);
  const fallbackSkills =
    targetSkills.length > 0
      ? targetSkills
      : (career.requiredSkills || []).slice(0, 3).map(s => ({
          skill: s,
          userLevel: 'Developing' as const,
          priority: 'Medium' as const,
          category: 'Technical' as const
        }));

  const p1Steps = buildMilestoneStepsForSkills(fallbackSkills.slice(0, 2), career, 'foundation');
  const p2Steps = buildMilestoneStepsForSkills(fallbackSkills.slice(1, 3), career, 'intermediate');

  const phase1: RoadmapPhase = {
    phaseNumber: 1,
    name: isGrade11
      ? 'Chặng 1 (Lớp 11): Giữ vững Học lực Tổ hợp & Xây nền Kỹ năng Nghề'
      : 'Chặng 1 (Lớp 10): Thích nghi THPT, Chọn Tổ hợp & Rèn Thói quen Tự học',
    duration: isGrade11 ? 'Học kỳ 1 Lớp 11' : 'Học kỳ 1–2 Lớp 10',
    timeframe: isGrade11 ? 'HK1 Lớp 11' : 'Năm học Lớp 10',
    stageCategory: 'highschool-prep',
    examFocus: plannedExams,
    objectives: [
      isGrade11
        ? `Duy trì học lực ổn định các môn liên quan (${comboStr}) để không bị quá tải khi bước sang Lớp 12`
        : 'Ổn định phương pháp học bậc THPT và kiểm chứng sự phù hợp giữa tổ hợp môn học với ngành mục tiêu',
      `Phát triển kỹ năng nền tảng và thử nghiệm nhẹ nhàng với nghề ${career.title}`
    ],
    skillsToLearn: ['Phương pháp tự học bậc THPT', 'Ngoại ngữ nền tảng', ...fallbackSkills.slice(0, 1).map(s => s.skill)],
    foundationalSkills: ['Phương pháp tự học bậc THPT', 'Quản lý thời gian', 'Ngoại ngữ nền tảng'],
    specializedSkills: fallbackSkills.slice(0, 1).map(s => s.skill),
    studyTasks: [
      {
        subjectOrCompetency: `Các môn học nền tảng (${comboStr})`,
        topicFocus: hasTopicDiagnostic
          ? `Chuyên đề cần củng cố: ${weakTopics.join(', ')}`
          : 'Chưa có dữ liệu chuyên đề yếu — Theo dõi bài kiểm tra định kỳ trên lớp để ghi nhận phần hổng',
        hasTopicDiagnostic,
        specificGoal: isGrade11
          ? 'Nắm chắc kiến thức lớp 11 vì đây là phần giao thoa quan trọng trong các kỳ thi tuyển sinh.'
          : 'Giữ điểm số ổn định các môn thế mạnh và xây thói quen tự học đều đặn.',
        studyMethod: 'Tóm tắt lý thuyết theo sơ đồ sau mỗi chương, làm bài tập từ cơ bản đến khá trước khi thi thử.',
        estimatedDuration: `${Math.max(2, Math.round((hoursPerWeek * examRatio) / 100))} giờ/tuần`,
        verificationMethod: 'Hoàn thành tốt các bài kiểm tra định kỳ trên lớp và không để nợ kiến thức nền.'
      }
    ],
    projects: [
      career.experiments?.[0]?.title || `Trải nghiệm nhập môn nhẹ nhàng cho ${career.title}`
    ],
    recommendedActivities: [
      'Tham gia CLB học thuật / ngoại khóa phù hợp với sở thích',
      'Bắt đầu tích lũy chứng chỉ ngoại ngữ (nếu có định hướng)'
    ],
    milestone: isGrade11
      ? 'Hoàn thành chắc chương trình HK1 Lớp 11 và có 1 trải nghiệm thực tế đầu tiên về ngành.'
      : 'Xác định rõ tổ hợp môn thế mạnh và duy trì lịch tự học ổn định.',
    actionSteps: p1Steps
  };

  const phase2: RoadmapPhase = {
    phaseNumber: 2,
    name: isGrade11
      ? 'Chặng 2 (Cuối Lớp 11 – Hè sang 12): Làm quen Cấu trúc Thi & Hoàn thiện Dự án Khám phá'
      : 'Chặng 2 (Hè Lớp 10 sang 11): Khám phá Sâu hơn Ngành nghề & Kỹ năng Số',
    duration: isGrade11 ? 'Học kỳ 2 Lớp 11 – Hè lên 12' : 'Học kỳ 2 – Hè lên 11',
    timeframe: isGrade11 ? 'HK2 & Hè 11→12' : 'HK2 & Hè 10→11',
    stageCategory: 'highschool-prep',
    examFocus: plannedExams,
    objectives: [
      isGrade11
        ? `Làm quen trước cấu trúc kỳ thi dự kiến (${plannedExams.length > 0 ? plannedExams.join(', ') : 'THPT / ĐGNL phù hợp'}) để giảm áp lực năm Lớp 12`
        : `Thực hiện mini-project nhập môn để kiểm tra mức độ hứng thú thực tế với nghề ${career.title}`,
      'Nâng cấp các kỹ năng đang ở mức Developing trước khi bước vào giai đoạn ưu tiên thi cử'
    ],
    skillsToLearn: fallbackSkills.map(s => s.skill),
    foundationalSkills: ['Tư duy phản biện & Giải quyết vấn đề', 'Giao tiếp & Hợp tác nhóm'],
    specializedSkills: fallbackSkills.map(s => s.skill),
    projects: [
      career.beginnerProjects?.[0] || `Mini-project khám phá thực tế ngành ${career.title}`
    ],
    recommendedActivities: [
      isGrade11
        ? 'Thử 1 đề tham khảo để biết định dạng câu hỏi (không đặt nặng điểm số ngay)'
        : 'Phỏng vấn hoặc tìm hiểu chia sẻ từ sinh viên/người đi làm trong ngành',
      'Lưu lại sản phẩm học tập vào hồ sơ cá nhân'
    ],
    milestone: isGrade11
      ? 'Sẵn sàng bước vào năm Lớp 12 với nền tảng vững và đã thử sức ít nhất 1 dự án khám phá ngành.'
      : 'Kiểm chứng được mức độ phù hợp thực tế với ngành và sẵn sàng nâng cao ở Lớp 11.',
    actionSteps: p2Steps
  };

  return {
    careerId: career.id,
    careerTitle: career.title,
    targetAgeGroup: '15-18',
    stageLabel: isGrade11
      ? 'Lớp 11 — Xây nền Kiến thức & Khám phá Chuyên sâu trước Năm cuối'
      : 'Lớp 10 — Khám phá Tổ hợp, Thói quen Tự học & Trải nghiệm Ngành',
    gradeDetected: `Lớp ${gradeNum}`,
    allocation: {
      examRatio,
      skillRatio,
      isDefault: typeof custom !== 'number',
      isUserAdjusted: typeof custom === 'number',
      rationale:
        typeof custom === 'number'
          ? `Tỷ lệ do học sinh tự điều chỉnh (${examRatio}% học tập/thi cử · ${skillRatio}% kỹ năng & trải nghiệm).`
          : isGrade11
          ? 'Mức tham chiếu Lớp 11 (45% củng cố học thuật & làm quen thi · 55% phát triển kỹ năng nền tảng và thử nghiệm ngành) trước khi tăng tốc ở Lớp 12.'
          : 'Mức tham chiếu Lớp 10 (30% học thuật trên lớp · 70% xây thói quen tự học, ngoại ngữ và khám phá nghề nghiệp).'
    },
    needsExamConfirmation: false,
    isTimelineEstimated: false,
    plannedExams,
    source: 'engine',
    phases: [phase1, phase2],
    tailoredNote: `Lộ trình Lớp ${gradeNum} cho ${studentName} (${hoursPerWeek}h/tuần): Tập trung cân bằng giữa giữ vững học lực trên lớp (${examRatio}%) và xây dựng kỹ năng, trải nghiệm thực tế cho ngành ${career.title} (${skillRatio}%) trước khi bước vào giai đoạn cao điểm thi cử.`
  };
}

/**
 * Builds age-calibrated roadmaps for all remaining 5 age groups:
 * '6-10', '11-14', '19-24', '25-35', '35+'.
 */
function buildOtherAgeGroupRoadmap(
  normAge: '6-10' | '11-14' | '19-24' | '25-35' | '35+',
  profile: UserProfile,
  career: Career,
  gap: SkillGapAnalysis,
  hoursPerWeek: number
): LearningRoadmap {
  const studentName = profile.name?.trim() || 'Học viên';
  const targetSkills = [...gap.missingSkills.slice(0, 3), ...gap.developingSkills.slice(0, 2)].slice(0, 3);
  const baseSkills =
    targetSkills.length > 0
      ? targetSkills
      : (career.requiredSkills || []).slice(0, 3).map(s => ({
          skill: s,
          userLevel: 'Developing' as const,
          priority: 'Medium' as const,
          category: 'Technical' as const
        }));

  if (normAge === '6-10') {
    const phases: RoadmapPhase[] = [
      {
        phaseNumber: 1,
        name: 'Giai đoạn 1: Khơi gợi Trí tò mò & Niềm vui Khám phá',
        duration: '3–6 tháng (Nhẹ nhàng theo sở thích)',
        timeframe: 'Khám phá tự nhiên',
        stageCategory: 'exploration',
        objectives: [
          'Nuôi dưỡng trí tò mò, quan sát thế giới xung quanh thông qua trò chơi tư duy và thí nghiệm vui',
          'Không đặt áp lực thi cử hay ép chọn nghề cố định quá sớm'
        ],
        skillsToLearn: ['Tư duy logic qua trò chơi', 'Giao tiếp & Chia sẻ với bạn bè', 'Quan sát sáng tạo'],
        foundationalSkills: ['Tư duy logic qua trò chơi', 'Giao tiếp & Chia sẻ', 'Quan sát sáng tạo'],
        specializedSkills: [],
        projects: [
          career.experiments?.[0]?.title || `Hoạt động trải nghiệm vui nhộn khám phá lĩnh vực ${career.careerCluster}`
        ],
        recommendedActivities: [
          'Tham gia CLB vẽ, lắp ráp, STEM thiếu nhi hoặc đọc truyện khoa học cùng phụ huynh',
          'Khuyến khích trẻ kể lại điều em thích sau mỗi hoạt động'
        ],
        milestone: 'Trẻ hứng thú tham gia hoạt động khám phá đều đặn mà không cảm thấy áp lực.'
      },
      {
        phaseNumber: 2,
        name: 'Giai đoạn 2: Hình thành Thói quen Học hỏi & Sản phẩm Nhỏ',
        duration: '6 tháng tiếp theo',
        timeframe: 'Ươm mầm năng khiếu',
        stageCategory: 'exploration',
        objectives: [
          'Rèn luyện sự tập trung ngắn hạn (20–30 phút/lần) và khả năng hoàn thành sản phẩm nhỏ của riêng mình',
          'Mở rộng tiếp xúc nhiều lĩnh vực khác nhau (nghệ thuật, tự nhiên, ngôn ngữ)'
        ],
        skillsToLearn: ['Hoàn thành nhiệm vụ nhỏ', 'Làm việc nhóm cùng bạn', 'Ngôn ngữ & Kể chuyện'],
        foundationalSkills: ['Hoàn thành nhiệm vụ nhỏ', 'Làm việc nhóm', 'Kể chuyện'],
        specializedSkills: [],
        projects: ['Tạo một sản phẩm sáng tạo nhỏ (tranh vẽ, mô hình lắp ghép, câu chuyện hoặc bài trình bày ngắn)'],
        recommendedActivities: [
          'Trưng bày sản phẩm của em trong góc học tập gia đình hoặc ở lớp',
          'Kết hợp vận động thể chất và hoạt động ngoài trời'
        ],
        milestone: 'Em tự tin giới thiệu sản phẩm nhỏ do mình thực hiện và duy trì niềm vui học hỏi.'
      }
    ];

    return {
      careerId: career.id,
      careerTitle: career.title,
      targetAgeGroup: '6-10',
      stageLabel: '6–10 tuổi (Tiểu học) — Khám phá Sở thích & Không Áp lực Thi cử',
      gradeDetected: profile.grade || 'Tiểu học',
      allocation: {
        examRatio: 0,
        skillRatio: 100,
        isDefault: true,
        rationale: 'Ở lứa tuổi Tiểu học (6–10 tuổi), 100% lộ trình tập trung vào khơi gợi niềm vui khám phá và kỹ năng tự nhiên, không áp lực thi tuyển.'
      },
      needsExamConfirmation: false,
      isTimelineEstimated: false,
      plannedExams: [],
      source: 'engine',
      phases,
      tailoredNote: `Lộ trình Tiểu học dành cho ${studentName}: Tập trung nuôi dưỡng trí tò mò, hoạt động STEM/sáng tạo vui nhộn liên quan tới ${career.careerCluster} và thói quen tích cực (${hoursPerWeek}h/tuần nhẹ nhàng).`
    };
  }

  if (normAge === '11-14') {
    const phases: RoadmapPhase[] = [
      {
        phaseNumber: 1,
        name: 'Giai đoạn 1 (THCS): Nhận diện Thiên hướng Môn học & Kỹ năng Tự học',
        duration: 'Học kỳ hiện tại',
        timeframe: 'Định hình thiên hướng',
        stageCategory: 'exploration',
        objectives: [
          'Khám phá sự khác biệt sở thích giữa nhóm môn Tự nhiên – Công nghệ và Xã hội – Nghệ thuật',
          'Xây dựng kỹ năng ghi chép, quản lý thời gian tự học và tin học căn bản'
        ],
        skillsToLearn: ['Kỹ năng tự học', 'Tư duy logic', 'Tin học & Ngoại ngữ cơ bản'],
        foundationalSkills: ['Kỹ năng tự học', 'Tư duy logic', 'Ngoại ngữ cơ bản'],
        specializedSkills: [],
        projects: [career.experiments?.[0]?.title || `Hoạt động thử nghiệm khám phá ${career.title}`],
        recommendedActivities: [
          'Tham gia CLB STEM, Tin học trẻ, Hùng biện hoặc Nghệ thuật ở trường THCS',
          'Đọc và tóm tắt các chủ đề em tò mò hàng tuần'
        ],
        milestone: 'Nhận diện rõ nhóm môn học yêu thích và duy trì lịch tự học đều đặn.'
      },
      {
        phaseNumber: 2,
        name: 'Giai đoạn 2 (THCS): Định hướng Thi vào Lớp 10 & Dự án Trải nghiệm',
        duration: 'Chặng chuẩn bị lên THPT',
        timeframe: 'Chuẩn bị lên Lớp 10',
        stageCategory: 'highschool-prep',
        objectives: [
          'Ôn tập vững 3 môn Toán – Ngữ văn – Ngoại ngữ (và môn chuyên nếu có nguyện vọng) cho kỳ chuyển cấp lên THPT',
          `Thử thực hiện 1 sản phẩm khám phá nhỏ gắn với ${career.title} để kiểm chứng hứng thú`
        ],
        skillsToLearn: baseSkills.slice(0, 2).map(s => s.skill),
        foundationalSkills: ['Ôn tập kiến thức Toán – Văn – Anh THCS', 'Làm việc nhóm'],
        specializedSkills: baseSkills.slice(0, 1).map(s => s.skill),
        projects: [career.beginnerProjects?.[0] || `Sản phẩm trải nghiệm THCS về ${career.title}`],
        recommendedActivities: [
          'Tìm hiểu các định hướng trường THPT (Công lập, Chuyên, Chất lượng cao hoặc Trung cấp nghề)',
          'Rèn thói quen kiểm tra lại bài làm để giảm lỗi sai sơ đẳng'
        ],
        milestone: 'Vững vàng kiến thức chuyển cấp lên Lớp 10 và có cái nhìn thực tế hơn về ngành nghề.'
      }
    ];

    return {
      careerId: career.id,
      careerTitle: career.title,
      targetAgeGroup: '11-14',
      stageLabel: '11–14 tuổi (THCS) — Định hình Thiên hướng & Chuẩn bị Lên Lớp 10',
      gradeDetected: profile.grade || 'THCS',
      allocation: {
        examRatio: 40,
        skillRatio: 60,
        isDefault: true,
        rationale: 'Mức tham chiếu THCS: 40% củng cố môn học chuyển cấp Lớp 10 · 60% xây kỹ năng tự học, ngoại ngữ và trải nghiệm đa lĩnh vực.'
      },
      needsExamConfirmation: false,
      isTimelineEstimated: false,
      plannedExams: [],
      source: 'engine',
      phases,
      tailoredNote: `Lộ trình THCS dành cho ${studentName}: Kết hợp giữ vững nền tảng Toán – Văn – Anh lên Lớp 10 và khám phá thiên hướng thực tế gắn với ${career.title}.`
    };
  }

  if (normAge === '19-24') {
    const p1Steps = buildMilestoneStepsForSkills(baseSkills.slice(0, 2), career, 'foundation');
    const p2Steps = buildMilestoneStepsForSkills(baseSkills.slice(1, 3), career, 'intermediate');
    const p3Steps = buildMilestoneStepsForSkills(
      (career.softSkills || ['Giao tiếp chuyên môn', 'Làm việc nhóm']).slice(0, 2).map(s => ({
        skill: s,
        userLevel: 'Developing' as const,
        priority: 'Medium' as const,
        category: 'Soft' as const
      })),
      career,
      'capstone'
    );

    const phases: RoadmapPhase[] = [
      {
        phaseNumber: 1,
        name: 'Giai đoạn 1: Lấp Lỗ hổng Chuyên ngành & Chuẩn hóa Công cụ',
        duration: '1–3 tháng tới',
        timeframe: '0–3 months',
        stageCategory: 'career-specialization',
        objectives: [
          `Giải quyết các kỹ năng cốt lõi đang thiếu (${gap.missingSkills.slice(0, 3).map(s => s.skill).join(', ') || career.requiredSkills.slice(0, 2).join(', ')})`,
          'Chuẩn hóa quy trình làm việc thực tế và ngoại ngữ chuyên ngành'
        ],
        skillsToLearn: baseSkills.slice(0, 2).map(s => s.skill),
        foundationalSkills: ['Tiếng Anh chuyên ngành', 'Quản lý dự án cá nhân'],
        specializedSkills: baseSkills.slice(0, 2).map(s => s.skill),
        projects: [career.beginnerProjects?.[0] || `Dự án thực hành 1 cho ${career.title}`],
        recommendedActivities: [
          'Tham khảo chuẩn tuyển dụng thực tập sinh tại doanh nghiệp',
          'Hoàn thiện tài liệu hóa sản phẩm trên GitHub / Portfolio'
        ],
        milestone: 'Hoàn thành mini-project chuyên ngành có thể trình bày trong CV thực tập.',
        actionSteps: p1Steps
      },
      {
        phaseNumber: 2,
        name: 'Giai đoạn 2: Dự án Tích hợp & Chứng chỉ Nghề nghiệp',
        duration: '3–6 tháng tiếp theo',
        timeframe: '3–6 months',
        stageCategory: 'career-specialization',
        objectives: [
          'Xây dựng dự án mô phỏng quy trình doanh nghiệp hoàn chỉnh, có kiểm thử và đo lường',
          `Xem xét các chứng chỉ uy tín trong ngành: ${(career.certifications || []).slice(0, 2).join(', ') || 'Chứng chỉ chuyên môn phù hợp'}`
        ],
        skillsToLearn: baseSkills.map(s => s.skill),
        foundationalSkills: ['Giải quyết vấn đề liên ngành'],
        specializedSkills: baseSkills.map(s => s.skill),
        projects: [career.portfolioExamples?.[0] || `Dự án Portfolio trọng tâm của ${career.title}`],
        recommendedActivities: [
          'Luyện phỏng vấn kỹ thuật / tình huống thực tế',
          'Nhận phản hồi từ mentor hoặc anh/chị đi trước trong ngành'
        ],
        milestone: 'Sở hữu ít nhất 2 dự án chất lượng trong Portfolio và CV sẵn sàng ứng tuyển.',
        actionSteps: p2Steps
      },
      {
        phaseNumber: 3,
        name: 'Giai đoạn 3: Ứng tuyển Thực tập (Internship) & Vị trí Khởi điểm',
        duration: '6–12 tháng',
        timeframe: '6–12 months',
        stageCategory: 'career-specialization',
        objectives: [
          `Ứng tuyển thực tập hoặc vị trí khởi điểm (${career.progressionPath?.entry || 'Junior / Thực tập sinh'})`,
          'Hoàn thiện kỹ năng phối hợp đa phòng ban và thích ứng quy trình công việc thực tế'
        ],
        skillsToLearn: career.softSkills.slice(0, 3),
        foundationalSkills: career.softSkills.slice(0, 3),
        specializedSkills: career.technicalSkills.slice(0, 2),
        projects: ['Hồ sơ ứng tuyển hoàn chỉnh (CV + Portfolio Demo + Case Study)'],
        recommendedActivities: [
          'Tham gia Ngày hội việc làm tại trường hoặc cộng đồng chuyên môn',
          'Tổng kết bài học sau mỗi vòng phỏng vấn để cải thiện liên tục'
        ],
        milestone: 'Đạt trạng thái sẵn sàng ứng tuyển thực tập hoặc việc làm chính thức.',
        actionSteps: p3Steps
      }
    ];

    return {
      careerId: career.id,
      careerTitle: career.title,
      targetAgeGroup: '19-24',
      stageLabel: '19–24 tuổi (Sinh viên / Học nghề) — Chuyên môn sâu, Portfolio & Thực tập',
      gradeDetected: profile.grade || 'Sinh viên / Học nghề',
      allocation: {
        examRatio: 0,
        skillRatio: 100,
        isDefault: true,
        rationale: 'Ở giai đoạn Sinh viên / Học nghề, 100% quỹ tự học ưu tiên phát triển năng lực chuyên môn, dự án thực tế và sẵn sàng nghề nghiệp.'
      },
      needsExamConfirmation: false,
      isTimelineEstimated: false,
      plannedExams: [],
      source: 'engine',
      phases,
      tailoredNote: `Lộ trình Sinh viên / Học nghề cho ${studentName} (Chỉ số sẵn sàng hiện tại ${gap.overallReadiness}%, ${hoursPerWeek}h/tuần): Tập trung đóng khoảng trống kỹ năng, làm dự án thực chiến và chuẩn bị hồ sơ thực tập cho ${career.title}.`
    };
  }

  if (normAge === '25-35') {
    const p1Steps = buildMilestoneStepsForSkills(baseSkills.slice(0, 2), career, 'foundation');
    const p2Steps = buildMilestoneStepsForSkills(baseSkills.slice(1, 3), career, 'capstone');

    const phases: RoadmapPhase[] = [
      {
        phaseNumber: 1,
        name: 'Giai đoạn 1: Kiểm kê Kỹ năng Chuyển đổi & Bổ sung Lõi Chuyên ngành',
        duration: '0–3 tháng (Học ngoài giờ làm việc)',
        timeframe: '0–3 months',
        stageCategory: 'transition',
        objectives: [
          'Xác định kỹ năng sẵn có từ công việc cũ có thể chuyển đổi (Transferable Skills) sang ngành mới',
          `Học trọng tâm các kỹ năng cốt lõi còn thiếu của ${career.title} mà không làm gián đoạn thu nhập hiện tại`
        ],
        skillsToLearn: baseSkills.slice(0, 2).map(s => s.skill),
        foundationalSkills: ['Quản lý thời gian vừa làm vừa học', 'Kỹ năng chuyển đổi từ kinh nghiệm cũ'],
        specializedSkills: baseSkills.slice(0, 2).map(s => s.skill),
        projects: [career.beginnerProjects?.[0] || `Bài toán thực tế kết nối kinh nghiệm cũ với ${career.title}`],
        recommendedActivities: [
          `Duy trì lịch học tập bền bỉ ${hoursPerWeek}h/tuần vào buổi tối hoặc cuối tuần`,
          'Tìm hiểu mô hình công việc kết hợp (Bridge Role) tận dụng nền tảng cũ'
        ],
        milestone: 'Hoàn thành sản phẩm đầu tiên chứng minh năng lực ứng dụng vào ngành mục tiêu.',
        actionSteps: p1Steps
      },
      {
        phaseNumber: 2,
        name: 'Giai đoạn 2: Portfolio Chuyển ngành & Chiến lược Chuyển tiếp An toàn',
        duration: '3–6 tháng tiếp theo',
        timeframe: '3–6 months',
        stageCategory: 'transition',
        objectives: [
          'Xây dựng 1–2 case study giải quyết vấn đề thật cho doanh nghiệp hoặc dự án cá nhân',
          'Mở rộng mạng lưới chuyên môn và chuẩn bị kế hoạch chuyển việc giảm thiểu rủi ro tài chính'
        ],
        skillsToLearn: baseSkills.map(s => s.skill),
        foundationalSkills: ['Đàm phán & Trình bày giá trị chuyển đổi'],
        specializedSkills: baseSkills.map(s => s.skill),
        projects: [career.portfolioExamples?.[0] || `Case study chuyển ngành cho ${career.title}`],
        recommendedActivities: [
          'Tham vấn người làm trong ngành để rà soát độ thực tế của Portfolio',
          'Ứng tuyển thử nghiệm hoặc nhận dự án nhỏ bên ngoài trước khi nghỉ việc cũ'
        ],
        milestone: 'Có bộ Portfolio chuyển ngành thuyết phục và phương án tài chính an toàn khi chuyển đổi.',
        actionSteps: p2Steps
      }
    ];

    return {
      careerId: career.id,
      careerTitle: career.title,
      targetAgeGroup: '25-35',
      stageLabel: '25–35 tuổi (Người đi làm) — Chuyển ngành An toàn & Tối ưu Kỹ năng Chuyển đổi',
      gradeDetected: profile.grade || 'Người đi làm',
      allocation: {
        examRatio: 0,
        skillRatio: 100,
        isDefault: true,
        rationale: 'Ở giai đoạn 25–35 tuổi, lộ trình ưu tiên 100% kỹ năng chuyển đổi thực chiến và phương án học ngoài giờ bảo toàn thu nhập.'
      },
      needsExamConfirmation: false,
      isTimelineEstimated: false,
      plannedExams: [],
      source: 'engine',
      phases,
      tailoredNote: `Lộ trình Người đi làm cho ${studentName} (${hoursPerWeek}h/tuần): Tận dụng kinh nghiệm sẵn có, học tập có chọn lọc để chuyển hướng hoặc bứt phá trong ${career.title} mà vẫn duy trì ổn định tài chính.`
    };
  }

  // Age 35+
  const phases: RoadmapPhase[] = [
    {
      phaseNumber: 1,
      name: 'Giai đoạn 1: Tái định vị Chiến lược & Kết hợp Công cụ Hiện đại (AI/Số hóa)',
      duration: '0–3 tháng',
      timeframe: '0–3 months',
      stageCategory: 'transition',
      objectives: [
        'Tận dụng kinh nghiệm quản lý, chuyên môn dày dặn để định vị ở vai trò cố vấn, quản lý hoặc chuyên gia giải pháp',
        `Cập nhật các năng lực mới của ${career.title} (bao gồm cộng tác với công cụ AI và quản trị thay đổi)`
      ],
      skillsToLearn: baseSkills.slice(0, 2).map(s => s.skill),
      foundationalSkills: ['Lãnh đạo & Cố vấn (Mentoring)', 'Quản trị thay đổi & Thích ứng công nghệ'],
      specializedSkills: baseSkills.slice(0, 2).map(s => s.skill),
      projects: ['Bản kế hoạch tái định vị năng lực & giải pháp tư vấn dựa trên kinh nghiệm thực chiến'],
      recommendedActivities: [
        'Chọn lọc công cụ số giúp tăng hiệu suất thay vì học dàn trải kỹ thuật sơ cấp',
        'Xây dựng uy tín chuyên môn qua chia sẻ kinh nghiệm thực tế'
      ],
      milestone: 'Xác định rõ phân khúc giá trị cao nhất có thể đóng góp ở vai trò cố vấn/lãnh đạo.'
    },
    {
      phaseNumber: 2,
      name: 'Giai đoạn 2: Mở rộng Ảnh hưởng & Cân bằng Bền vững',
      duration: '3–6 tháng',
      timeframe: '3–6 months',
      stageCategory: 'transition',
      objectives: [
        `Hướng tới vị trí mục tiêu (${career.progressionPath?.senior || 'Chuyên gia / Quản lý / Cố vấn độc lập'})`,
        'Cân bằng giữa phát triển sự nghiệp dài hạn, sức khỏe và trách nhiệm gia đình'
      ],
      skillsToLearn: career.softSkills.slice(0, 3),
      foundationalSkills: ['Xây dựng mạng lưới đối tác chiến lược', 'Cân bằng công việc – cuộc sống'],
      specializedSkills: career.requiredSkills.slice(0, 2),
      projects: ['Triển khai 1 sáng kiến cải tiến hoặc dự án tư vấn độc lập quy mô vừa'],
      recommendedActivities: [
        'Kết nối với mạng lưới lãnh đạo / cộng đồng chuyên gia trong ngành',
        'Đo lường hiệu quả định kỳ hàng tháng'
      ],
      milestone: 'Định vị vững chắc vai trò chuyên gia/quản lý hoặc mô hình công việc độc lập bền vững.'
    }
  ];

  return {
    careerId: career.id,
    careerTitle: career.title,
    targetAgeGroup: '35+',
    stageLabel: '35+ tuổi (Chuyên gia / Quản lý) — Tái định vị, Cố vấn & Phát triển Bền vững',
    gradeDetected: profile.grade || 'Chuyên gia / Quản lý',
    allocation: {
      examRatio: 0,
      skillRatio: 100,
      isDefault: true,
      rationale: 'Ở giai đoạn 35+ tuổi, 100% lộ trình tập trung vào tận dụng kinh nghiệm tích lũy, cập nhật công nghệ cốt lõi và định vị vai trò lãnh đạo/cố vấn.'
    },
    needsExamConfirmation: false,
    isTimelineEstimated: false,
    plannedExams: [],
    source: 'engine',
    phases,
    tailoredNote: `Lộ trình Chuyên gia / Quản lý (35+) cho ${studentName}: Tập trung chuyển hóa kinh nghiệm lâu năm kết hợp năng lực mới của ${career.title} để tạo giá trị bền vững (${hoursPerWeek}h/tuần).`
  };
}

/**
 * Main entry point: Deterministic Hybrid Roadmap Engine.
 * Routes strictly by normalized age group and high-school grade:
 * - Grade 12: Exam-timeline-driven (Pre-exam with flexible ratio & foundational skills ONLY -> Post-exam specialized skills)
 * - Grade 10 & Grade 11: Balanced high school progression
 * - Other 5 age groups (6-10, 11-14, 19-24, 25-35, 35+): Age-calibrated roadmaps
 */
export function generateLearningRoadmap(
  profile: UserProfile,
  career: Career,
  externalSkillGap?: SkillGapAnalysis
): LearningRoadmap {
  const gap = externalSkillGap || analyzeSkillGap(profile, career);
  const hoursPerWeek = Math.max(2, Number(profile.availableStudyTimeHoursPerWeek || 10));
  const normAge = normalizeAgeGroup(profile.ageGroup, profile.age);

  if (normAge === '15-18') {
    const grade = detectHighSchoolGrade(profile);
    if (grade === '12') {
      return buildGrade12Roadmap(profile, career, gap, hoursPerWeek);
    }
    return buildGrade10Or11Roadmap(profile, career, gap, hoursPerWeek, grade);
  }

  return buildOtherAgeGroupRoadmap(normAge, profile, career, gap, hoursPerWeek);
}
