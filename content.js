/* content.js — 쉐도잉 클립 60 · 롤플레이 12 · 4-3-2 주제 20 · 발음 힌트 20
   쉐도잉 "클립"은 실제 오디오 파일이 없어 TTS(speechSynthesis)로 재생하는 대본이다.
   duration_sec는 문장 사이 쉼 포함 자연 속도(약 2.3단어/초) 기준 추정치. */
(function () {
  'use strict';

  /* 관심 주제(온보딩 최대 3개) */
  var INTERESTS = {
    cafe_food: '카페·식당', smalltalk: '스몰토크', hobbies: '취미', family_daily: '가족·일상', health: '건강',
    shopping: '쇼핑', movies: '영화·드라마', meetings: '회의', email_phone: '이메일·통화', tech: 'IT·업무툴',
    travel: '여행', interview: '면접'
  };

  /* 한국인 빈출 발음 힌트 20 */
  var HINTS = {
    f_p: 'f는 윗니를 아랫입술에 살짝 대고 바람 — p(ㅍ)로 내지 않기',
    v_b: 'v는 f처럼 윗니+아랫입술에 목소리를 얹기 — b(ㅂ)와 구분',
    th_voiceless: 'th(θ)는 혀끝을 윗니 사이에 살짝 — ㅆ/ㄸ로 바꾸지 않기 (think, thanks)',
    th_voiced: '울리는 th(ð)는 혀끝을 이 사이에 두고 목소리 (this, though)',
    z_j: 'z는 벌 소리 "즈~" — ㅈ(j)로 바꾸지 않기 (busy, shoes)',
    r_l: 'r은 혀끝이 어디에도 닿지 않게 입술 둥글게, l은 혀끝을 윗잇몸에 붙이기',
    final_consonant: '끝 자음 뒤에 "으"를 붙이지 않기 — book은 "부크"가 아니라 "북"',
    stress: '강세 음절을 길고 크게, 나머지는 짧게 (re-SPON-si-ble, per-CENT)',
    linking: '자음으로 끝나고 모음으로 시작하면 이어 붙이기 (pick_it_up → 피키럽)',
    flap_t: '모음 사이 t는 가볍게 ㄹ처럼 (water → 워러, get it → 게릿)',
    weak_forms: 'to, for, can, and 같은 기능어는 약하고 짧게 — 내용어만 또렷하게',
    gonna: 'going to → gonna, want to → wanna: 자연스러운 구어 축약',
    question_intonation: 'Yes/No 질문은 끝을 올리고 ↗, Wh- 질문과 확인형 부가의문문은 내리기 ↘',
    sentence_stress: '문장에서 중요한 단어(명사·동사·형용사)만 세게 — 리듬이 생겨요',
    ed_endings: '-ed는 /t/ /d/ /ɪd/ 세 가지 — "에드"로 읽지 않기 (missed → 미스트)',
    s_endings: '끝의 -s/-es를 흘리지 말고 분명히 (keeps, crashes)',
    w_sound: 'w는 입술을 동그랗게 모았다가 풀기 — would는 "우드"가 아니라 짧은 "욷"',
    ae_e: '/æ/(bad)는 입을 크게 벌리고, /e/(bed)는 작게 — 구분하면 더 잘 통해요',
    i_ee: '짧은 i(ship)와 긴 ee(sheep)를 길이로 구분하기',
    h_drop: '빠른 말에서 him, her의 h는 약해져요 (tell him → 텔림)'
  };

  function clip(id, level, topic, tag, script, focus, hint, ko) {
    var words = script.split(/\s+/).length;
    return { id: id, level: level, topic: topic, tag: tag, duration_sec: Math.round(words / 2.3), script: script, focus: focus, hint: hint, ko: ko, accent: 'us' };
  }

  var CLIPS = [
    // --- daily: 카페·식당
    clip('sh_001', 'a2', 'daily', 'cafe_food', "Hi, can I get a medium latte? Oh, and could you make it with oat milk? Thanks. Actually, can I get it to go? I'm running a little late this morning.", "can I get ~ 주문 표현 · can은 약하게 '큰'", 'weak_forms', '라테 주문하고 포장 요청하기'),
    clip('sh_002', 'b1', 'daily', 'cafe_food', "I was going to cook tonight, but honestly, I'm way too tired. Let's just order something. Are you in the mood for Korean or Thai? I'm fine with either.", "I was going to → I was gonna", 'gonna', '요리 대신 배달 시키자고 제안하기'),
    clip('sh_003', 'a2', 'daily', 'cafe_food', "This place is always packed at lunch. Let's grab a table by the window before it fills up. I'll order for both of us. What do you want?", "grab a table · fills up — 연음", 'linking', '붐비는 식당에서 자리 잡기'),
    clip('sh_004', 'b1', 'daily', 'cafe_food', "The food here is pretty good, but it's a little pricey. I usually come here when I want to treat myself, like after a long week at work.", "pretty good · a little — t가 ㄹ처럼", 'flap_t', '가끔 가는 식당 설명하기'),
    clip('sh_005', 'b2', 'daily', 'cafe_food', "I tried that new ramen place near the office. The broth was amazing, but the line was ridiculous. We waited almost forty minutes. Worth it, though. I'd go again.", "Worth it, though — 문장 끝에 though 덧붙이기", 'th_voiced', '새 라멘집 후기'),
    // --- 스몰토크
    clip('sh_006', 'a2', 'daily', 'smalltalk', "Hey, how was your weekend? Did you do anything fun? I didn't do much. I just stayed home, watched a movie, and caught up on some sleep.", "Did you → 디쥬 · I didn't do much", 'linking', '주말 안부 묻고 답하기'),
    clip('sh_007', 'b1', 'daily', 'smalltalk', "It's been a while! How have you been? I heard you changed jobs. How's the new place? Are you getting used to it? We should grab lunch sometime.", "How have you been → How've you been", 'weak_forms', '오랜만에 만난 사람과 근황'),
    clip('sh_008', 'a2', 'daily', 'smalltalk', "Wow, it's really cold today, isn't it? I should've worn a thicker jacket. I think it's supposed to snow this weekend. I'm not ready for winter yet.", "isn't it? — 동의를 구하는 부가의문문은 끝을 내리기", 'question_intonation', '날씨 스몰토크'),
    clip('sh_009', 'b1', 'daily', 'smalltalk', "So, what do you do for fun? I've been getting into hiking lately. There's a nice trail not too far from here, if you ever want to come along.", "getting into = ~에 빠지다", 'flap_t', '취미 묻고 같이 가자고 하기'),
    clip('sh_010', 'b1', 'daily', 'smalltalk', "Any plans for the holidays? I'm thinking about visiting my parents. They live about three hours away, so I don't get to see them that often.", "three · think — th(θ)", 'th_voiceless', '연휴 계획 이야기'),
    clip('sh_011', 'b2', 'daily', 'smalltalk', "I know what you mean. Mondays are always rough for me too. By the time I get through my emails, it's already lunchtime. I need more coffee.", "I know what you mean — what you → 와츄", 'linking', '월요일 공감하기'),
    // --- 취미
    clip('sh_012', 'a2', 'daily', 'hobbies', "I like to go running in the morning. It helps me clear my head before work. I'm not fast, but I try to go three times a week.", "running · morning — 끝 ng에 '으' 붙이지 않기", 'final_consonant', '아침 달리기 습관'),
    clip('sh_013', 'b1', 'daily', 'hobbies', "I've been learning to play the guitar for about a year. I'm still pretty bad, but it's a nice way to relax after a stressful day.", "I've been learning — 계속 해 오는 중", 'v_b', '기타 배우는 이야기'),
    clip('sh_014', 'b1', 'daily', 'hobbies', "Lately I've been really into baking. Last weekend I made bread for the first time. It didn't look great, but it tasted pretty good. I'm going to try again this weekend.", "didn't look great — 끝 t는 멈추듯 짧게", 'final_consonant', '베이킹 첫 도전'),
    clip('sh_015', 'b2', 'daily', 'hobbies', "I used to play a lot of video games, but these days I barely have time. When I do play, it's usually something short I can finish in an evening.", "used to (유스투) — 예전 습관", 'weak_forms', '예전 취미와 지금'),
    // --- 가족·일상
    clip('sh_016', 'a2', 'daily', 'family_daily', "My morning routine is pretty simple. I wake up at six thirty, make some coffee, and check the news. Then I take the subway to work.", "wake up at — 웨이커팻 연음", 'linking', '아침 루틴 소개'),
    clip('sh_017', 'b1', 'daily', 'family_daily', "My sister just had a baby, so I've been visiting her a lot. He's so tiny. I'm not used to holding babies, so I'm always a little nervous.", "I'm not used to ~ing — ~에 익숙하지 않다", 'flap_t', '조카가 태어난 이야기'),
    clip('sh_018', 'a2', 'daily', 'family_daily', "I live in a small apartment near the river. It's not very big, but it's quiet, and I love the view at night. The rent is a little high, though.", "view · very — v 소리", 'v_b', '사는 집 소개'),
    clip('sh_019', 'b1', 'daily', 'family_daily', "On Sundays, I usually do the laundry, clean the house, and get ready for the week. It's boring, but I feel better on Monday if I do it.", "laundry — l로 시작", 'r_l', '일요일 집안일'),
    // --- 건강
    clip('sh_020', 'a2', 'daily', 'health', "I think I'm coming down with a cold. My throat hurts, and I feel really tired. I might work from home tomorrow. I'll let my manager know.", "coming down with a cold = 감기 기운이 있다", 'th_voiceless', '감기 기운 말하기'),
    clip('sh_021', 'b1', 'daily', 'health', "I've been trying to sleep better. No phone after eleven, and no coffee after two. It's hard, but I'm already feeling the difference. I actually wake up less tired.", "feeling the difference — f 두 번", 'f_p', '수면 습관 바꾸기'),
    clip('sh_022', 'b1', 'daily', 'health', "I finally made a dentist appointment. I've been putting it off for months. I'm a little scared, to be honest. I haven't been in about two years.", "putting it off — 미루다, t가 ㄹ처럼", 'flap_t', '치과 예약'),
    // --- 쇼핑
    clip('sh_023', 'a2', 'daily', 'shopping', "Excuse me, do you have this in a medium? And is it on sale? The tag says thirty percent off, but I wasn't sure. Can I try it on?", "thirty percent — per-CENT 강세", 'stress', '옷 가게에서 사이즈·할인 묻기'),
    clip('sh_024', 'b1', 'daily', 'shopping', "I ordered these shoes online, but they're too small. I need to send them back. Hopefully the return is free. If not, I'll just keep them for my niece.", "shoes — 끝 z 소리", 'z_j', '온라인 반품'),
    clip('sh_025', 'b2', 'daily', 'shopping', "I almost bought a new laptop yesterday, but I decided to wait. There's usually a big sale next month, so I'll hold off until then.", "hold off = 미루다 · 내용어만 세게", 'sentence_stress', '노트북 구매 보류'),
    // --- 영화·드라마
    clip('sh_026', 'a2', 'daily', 'movies', "Have you seen that new show everyone's talking about? I watched the first episode last night. It was really good. No spoilers, please! I haven't finished it yet.", "Have you seen ~? — 끝을 올리기", 'question_intonation', '요즘 드라마 이야기'),
    clip('sh_027', 'b1', 'daily', 'movies', "I'm not really into horror movies. I get scared too easily. I'd rather watch a comedy or something light. Want to watch something tonight?", "I'd rather ~ 차라리 ~하고 싶다", 'r_l', '좋아하는 장르'),
    clip('sh_028', 'b2', 'daily', 'movies', "The movie started slow, but the ending totally made up for it. I didn't see that twist coming at all. We should watch the sequel together.", "made up for it = 만회하다 · 리듬", 'sentence_stress', '영화 후기'),
    // --- work: 회의
    clip('sh_029', 'b1', 'work', 'meetings', "Can I jump in here for a second? I think we're missing one thing. If we move the launch up, we won't have time for testing.", "jump in here — 점핀히어", 'linking', '회의 중 끼어들어 의견 말하기'),
    clip('sh_030', 'b1', 'work', 'meetings', "Let me make sure I understand this correctly. You want the first draft by Friday, and the final version by the end of the month. Is that right?", "Is that right? — 확인 질문", 'question_intonation', '업무 요청 확인하기'),
    clip('sh_031', 'b2', 'work', 'meetings', "I see your point, but I'm not sure that'll work. Our team is already stretched pretty thin. Could we push the deadline by a week?", "that'll → 대를 · stretched thin = 여력이 없다", 'flap_t', '부드럽게 반대하고 대안 제시'),
    clip('sh_032', 'a2', 'work', 'meetings', "Okay, let's get started. Thanks for coming, everyone. Today we have three things to talk about. First, the budget. Then the new hires, and finally, the schedule.", "Thanks — 쌩스(θ), 땡스 아님", 'th_voiceless', '회의 시작하기'),
    clip('sh_033', 'b1', 'work', 'meetings', "Good point. Let's circle back to that later. We're running out of time, so let's focus on the schedule first. We can talk about the budget next week.", "running out of — 연음", 'linking', '회의 주제 정리하기'),
    clip('sh_034', 'b1', 'work', 'meetings', "So what's the next step? I can send out a summary after this meeting, and let's check in again on Thursday. Does that work for everyone?", "send out a · check in again — 연음", 'linking', '다음 단계 정하기'),
    clip('sh_035', 'b2', 'work', 'meetings', "I partly agree with you. The design looks great, but I'm worried about the cost. Maybe we could simplify a few features for the first version.", "I partly agree — 부분 동의", 'final_consonant', '부분 동의 + 우려'),
    // --- 이메일·통화
    clip('sh_036', 'a2', 'work', 'email_phone', "Hi, this is Minsu from the sales team. I'm calling about the order we placed last week. Do you have a minute? I just have a quick question about the delivery date.", "I'm calling about ~ — 전화 목적", 'weak_forms', '업무 전화 시작'),
    clip('sh_037', 'b1', 'work', 'email_phone', "Sorry, you're breaking up. Can you hear me okay? I think my connection is bad. Let me call you back in a minute. Sorry about that.", "breaking up — 통화 끊길 때", 'r_l', '통화 연결 문제'),
    clip('sh_038', 'b1', 'work', 'email_phone', "Hi Tom, I'm just following up on my last email about the contract. Let me know if you have any questions. I'd love to get this signed by Friday.", "following up on — 팔로윙어펀", 'f_p', '메일 후속 연락'),
    clip('sh_039', 'b1', 'work', 'email_phone', "Just to recap, we agreed to launch next month and review the budget on Friday. I'll send you the details by email. Thanks again for your time today.", "recap — ri-CAP 강세", 'stress', '통화 내용 정리'),
    clip('sh_040', 'a2', 'work', 'email_phone', "Thanks for calling. I'm not at my desk right now. Please leave a message, and I'll get back to you as soon as I can.", "get back to you — t가 약해짐", 'flap_t', '음성 메시지 인사말'),
    clip('sh_041', 'b2', 'work', 'email_phone', "I'm afraid I'll need a bit more time on this. Would it be possible to move our call to next week? Sorry for the short notice.", "Would it be possible — w 소리", 'w_sound', '일정 연기 요청'),
    // --- IT·업무툴
    clip('sh_042', 'b1', 'work', 'tech', "The app keeps crashing when I try to upload a file. I've already restarted it twice. Could you take a look when you have a chance?", "keeps crashing — 끝 s 분명히", 's_endings', 'IT 문제 도움 요청'),
    clip('sh_043', 'b2', 'work', 'tech', "We're rolling out the new system next Monday. There might be a few bugs at first, so please report anything weird to the IT team.", "rolling out — r/l 연속", 'r_l', '새 시스템 공지'),
    clip('sh_044', 'b1', 'work', 'tech', "I'm working from home today. If you need me, just send me a message. I'll be online until six. I'll join the three o'clock meeting by video.", "working from home", 'final_consonant', '재택근무 알리기'),
    // --- travel
    clip('sh_045', 'a2', 'travel', 'travel', "Hi, I'd like to check in, please. I have a reservation under Kim. Is it possible to get a room on a higher floor? Thanks.", "I'd like to — I'd의 d는 약하게", 'weak_forms', '호텔 체크인'),
    clip('sh_046', 'a2', 'travel', 'travel', "Excuse me, how do I get to the train station from here? Is it within walking distance, or should I take a taxi? I have a lot of bags.", "A ↗ or B ↘ — 선택 의문문 억양", 'question_intonation', '길 묻기'),
    clip('sh_047', 'b1', 'travel', 'travel', "Sorry, I think there's a mistake on the bill. We only ordered two drinks, but we were charged for three. Could you check it again, please?", "charged — ed는 /d/", 'ed_endings', '계산서 오류 말하기'),
    clip('sh_048', 'a2', 'travel', 'travel', "Could we get the check, please? And do you take credit cards? We don't have any cash on us. Also, could we get a box for the leftovers?", "check — 끝 소리 짧게", 'final_consonant', '식당 계산'),
    clip('sh_049', 'b1', 'travel', 'travel', "My luggage didn't show up. I waited at the carousel for almost an hour. Where can I report it? It's a big black suitcase with a red tag.", "luggage — l 소리", 'r_l', '수하물 분실 신고'),
    clip('sh_050', 'b1', 'travel', 'travel', "I'm here on vacation for a week. I'm staying at a hotel downtown. This is my first time visiting, so I'm really excited. Any tips?", "vacation — v 소리", 'v_b', '여행 목적 말하기'),
    clip('sh_051', 'a2', 'travel', 'travel', "Could you take a picture of us? Just press this button. Maybe one more, with the bridge in the background? Thank you so much! Want me to take one of you?", "picture of us — 픽쳐러버스", 'linking', '사진 부탁하기'),
    clip('sh_052', 'b1', 'travel', 'travel', "Which stop should I get off at for the museum? Is it the next one, or the one after that? I don't want to miss it, so please let me know.", "get off at — 게라퍼랫", 'flap_t', '어디서 내리는지 묻기'),
    clip('sh_053', 'b2', 'travel', 'travel', "Our flight got delayed by three hours, so we missed our connection. The airline put us on the next flight, but we won't land until midnight.", "delayed /d/ · missed /t/", 'ed_endings', '항공편 지연 상황 설명'),
    // --- interview
    clip('sh_054', 'b1', 'interview', 'interview', "I've been working in marketing for about five years. Right now I'm responsible for our social media campaigns and a small team of three. I really enjoy it.", "responsible — re-SPON-si-ble", 'stress', '경력 소개'),
    clip('sh_055', 'b1', 'interview', 'interview', "One of my strengths is that I'm a quick learner. When I joined my current company, I picked up our new software in about two weeks.", "strengths — 자음 연속에 '으' 넣지 않기", 'final_consonant', '강점 말하기'),
    clip('sh_056', 'b2', 'interview', 'interview', "That's a good question. Let me think for a second. I'd say my biggest weakness is that I sometimes take on too much at once.", "Let me think — 시간 벌기", 'th_voiceless', '약점 질문에 답하기'),
    clip('sh_057', 'b1', 'interview', 'interview', "In my previous role, I led a project to cut costs. We looked at every step of the process, and in the end, we saved about twenty percent.", "looked /t/ · saved /d/", 'ed_endings', '성과 사례 말하기'),
    clip('sh_058', 'b2', 'interview', 'interview', "I'm looking for a role where I can grow and take on more responsibility. From what I've read, your company really invests in its people.", "grow — gr 연속", 'r_l', '지원 동기'),
    clip('sh_059', 'b1', 'interview', 'interview', "The biggest challenge was the tight deadline. I handled it by breaking the work into smaller tasks and checking in with the team every day.", "challenge — CHAL-lenge", 'stress', '어려움과 해결'),
    clip('sh_060', 'a2', 'interview', 'interview', "Thank you for having me today. I'm really excited about this opportunity. Could you tell me a bit more about the team? I'd love to hear more.", "Thank you for having me — 면접 첫인사", 'th_voiceless', '면접 인사와 질문')
  ];

  /* 롤플레이 12 (PRD 7.4.1). fastTalk: 상대가 일부러 빠르게/어렵게 말함 → 되묻기 전략 강제 */
  var SCENARIOS = [
    { id: 'rp_001', title: '카페 주문', goal: 'travel', turns: 4, must_use_chunk: ['Can I get'], repair_enabled: true,
      success: '원하는 음료와 옵션을 한 번에 주문하기', situation: '카페 카운터. 원하는 음료·사이즈·옵션을 주문하세요.',
      ai_role: 'a friendly barista at a busy cafe', opener: 'Hi there! What can I get for you today?', hint: 'Can I get a ___, please?' },
    { id: 'rp_002', title: '길 묻기 (빠른 안내)', goal: 'travel', turns: 4, must_use_chunk: ['Sorry, could you say that again?'], repair_enabled: true, fastTalk: true,
      strategy: '되묻기 · 확인하기', success: '빠른 길 안내를 되묻고, 들은 방향을 내 말로 확인하기',
      situation: '역을 찾고 있어요. 행인이 아주 빠르게 알려 줍니다. 놓치면 되묻는 게 정답이에요.',
      ai_role: 'a local passerby in a hurry who talks fast', opener: "Oh, the station? Sure, go straight two blocks, take a left at the bakery, cross the little bridge, and it's right there on your right, you can't miss it!", hint: 'Sorry, could you say that again?' },
    { id: 'rp_003', title: '스몰토크 (주말)', goal: 'daily', turns: 4, must_use_chunk: ['I just'], repair_enabled: true,
      success: '주말에 한 일과 느낌을 두 문장 이상으로 말하기', situation: '월요일 아침, 동료가 주말 이야기를 꺼냅니다.',
      ai_role: 'a friendly coworker on Monday morning', opener: 'Hey! How was your weekend? Did you do anything fun?', hint: 'I just stayed in and ___.' },
    { id: 'rp_004', title: '자기소개', goal: 'daily', turns: 4, must_use_chunk: ['I work in'], repair_enabled: true,
      success: '이름, 하는 일, 개인적인 한 가지를 말하기', situation: '새로 온 동료와 처음 인사합니다.',
      ai_role: 'a new coworker who just joined the design team', opener: "Hi, I don't think we've met. I'm Alex. I just joined the design team.", hint: 'Nice to meet you. I work in ___.' },
    { id: 'rp_005', title: '회의에서 의견 말하기', goal: 'work', turns: 4, must_use_chunk: ['I see your point, but'], repair_enabled: true,
      success: '의견 + 이유를 한 턴에 말하기', situation: '팀장이 다음 주 출시를 제안합니다. 내 의견과 이유를 말하세요.',
      ai_role: 'a team lead in a product meeting', opener: "I think we should launch the new app next week, even if a few features aren't ready. What do you think?", hint: "I see your point, but ___ because ___." },
    { id: 'rp_006', title: '동의 / 부분 동의', goal: 'work', turns: 4, must_use_chunk: ['I partly agree'], repair_enabled: true,
      success: '동의하는 부분과 다른 부분을 나눠 말하기', situation: '동료가 강한 의견을 말합니다. 전부 동의하지는 않아요.',
      ai_role: 'a coworker with a strong opinion', opener: "Honestly, I think everyone should be back in the office five days a week. Remote work just doesn't work. Don't you agree?", hint: 'I partly agree, but ___.' },
    { id: 'rp_007', title: '거절하기', goal: 'work', turns: 4, must_use_chunk: ["I'm afraid I can't"], repair_enabled: true,
      strategy: '시간 벌기 (Let me think for a second)', success: '정중하게 거절하고 이유나 대안을 말하기', situation: '금요일 회식 준비까지 떠맡기려 합니다. 정중하게 거절하세요.',
      ai_role: 'a pushy but friendly coworker', opener: "Hey, we're doing a team dinner on Friday night. You're coming, right? Oh, and could you organize it too?", hint: "I'm afraid I can't. I ___." },
    { id: 'rp_008', title: '사과 + 이유', goal: 'work', turns: 4, must_use_chunk: ['Sorry for the delay'], repair_enabled: true,
      success: '사과, 이유, 해결 계획을 말하기', situation: '오늘 아침까지 보내기로 한 보고서를 아직 못 보냈어요.',
      ai_role: 'a manager waiting for a report', opener: 'Hi, I was expecting that report this morning. Is everything okay?', hint: 'Sorry for the delay. I was ___.' },
    { id: 'rp_009', title: '일정 잡기', goal: 'work', turns: 4, must_use_chunk: ['work for you'], repair_enabled: true,
      success: '가능한 시간을 제안하고 확정하기', situation: '다음 주 고객 미팅 시간을 정해야 합니다.',
      ai_role: 'a coworker planning a client meeting', opener: 'We need to set up a meeting with the client next week. When are you free?', hint: 'Does Thursday at three work for you?' },
    { id: 'rp_010', title: '모르는 말 되묻기', goal: 'work', turns: 4, must_use_chunk: ['What do you mean by'], repair_enabled: true, fastTalk: true,
      strategy: '되묻기 · 도움 요청', success: '모르는 표현을 콕 집어 되묻고, 이해한 내용을 확인하기',
      situation: '동료가 관용어를 섞어 빠르게 말합니다. 모르는 표현을 되물어 보세요.',
      ai_role: 'a coworker who talks fast and uses idioms and jargon', opener: 'So, long story short, the vendor dropped the ball, so we need to ballpark a new timeline ASAP and loop in the client.', hint: "Sorry, what do you mean by '___'?" },
    { id: 'rp_011', title: '가벼운 불만 전달', goal: 'travel', turns: 4, must_use_chunk: ["I think there's a mistake"], repair_enabled: true,
      success: '화내지 않고 문제와 원하는 것을 분명히 말하기', situation: '식당에서 주문한 것과 다른 음식이 나왔어요. 정중하게 말해 보세요.',
      ai_role: 'a restaurant server', opener: 'Here you go, one seafood pasta. Enjoy your meal!', hint: "Excuse me, I think there's a mistake. I ordered ___." },
    { id: 'rp_012', title: '면접: 자기소개', goal: 'interview', turns: 4, must_use_chunk: ["I've been working"], repair_enabled: true,
      success: '경력·강점·지원 이유를 1분 안에 말하기', situation: '영어 면접의 첫 질문입니다.',
      ai_role: 'a friendly job interviewer', opener: 'Thanks for coming in today. So, to start, could you tell me a little about yourself?', hint: "I've been working in ___ for ___ years." }
  ];

  /* 4-3-2 주제 20 (이미 아는 것) */
  var TOPICS = [
    { ko: '지난 주말에 한 일', en: 'What did you do last weekend?' },
    { ko: '내가 하는 일 소개', en: 'What do you do at work? Describe a typical day.' },
    { ko: '요즘 빠진 취미', en: "Talk about a hobby you're into these days." },
    { ko: '어제 하루', en: 'Walk me through your day yesterday.' },
    { ko: '출퇴근길', en: 'Describe your commute.' },
    { ko: '좋아하는 음식', en: "What's your favorite food, and why?" },
    { ko: '내 고향', en: 'Tell me about your hometown.' },
    { ko: '최근 여행', en: 'Talk about a recent trip.' },
    { ko: '진행 중인 프로젝트', en: "Talk about a project you're working on." },
    { ko: '우리 팀', en: 'Introduce your team.' },
    { ko: '친한 친구 한 명', en: 'Tell me about a close friend.' },
    { ko: '스트레스 푸는 법', en: 'How do you deal with stress?' },
    { ko: '아침 루틴', en: 'Describe your morning routine.' },
    { ko: '최근 본 영화·드라마', en: 'Talk about a movie or show you watched recently.' },
    { ko: '영어 공부', en: "How are you learning English, and what's hard about it?" },
    { ko: '기억에 남는 휴가', en: 'Tell me about a vacation you remember.' },
    { ko: '우리 집', en: 'Describe where you live.' },
    { ko: '최근에 산 물건', en: 'Talk about something you bought recently.' },
    { ko: '건강 습관', en: 'What do you do to stay healthy?' },
    { ko: '올해 목표', en: 'What are your goals for this year?' }
  ];

  /* 진행 화면: 주 1회 동일 프롬프트 재녹음 */
  var WEEKLY_PROMPT = { id: 'weekend', ko: '주말에 뭐 했어요?', en: 'What did you do last weekend? Tell me about it.' };
  var INTRO_PROMPT = { id: 'intro', ko: '30초 자기소개', en: 'Tell me about yourself in 30 seconds.' };

  window.SPEAK_CONTENT = { INTERESTS: INTERESTS, HINTS: HINTS, CLIPS: CLIPS, SCENARIOS: SCENARIOS, TOPICS: TOPICS, WEEKLY_PROMPT: WEEKLY_PROMPT, INTRO_PROMPT: INTRO_PROMPT };
})();
