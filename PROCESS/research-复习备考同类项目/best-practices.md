# 复习 / 考点 / 备考 同类项目基准对照（maxloop 阶段零 · 2026-11-20）

> 目标：给「复习资料图书馆」找**可复用且确认可用**的外部实现。禁止凭文章/星数下结论，所有结论带逐字符锚点 + 真跑输出。
> 纪律：三组查询（中文功能侧 / GitHub 开源 / 英文 best practice）→ 两份基准（功能清单 + 结构）→ 对照表 → R/C/N 决策。
> **本文件只做基准与决策，不改产品代码**；融合与否由决策表说了算，不强行加功能。

---

## 零、结论先行

搜到的同类里，**只有一个项目形态与我方高度同构且真跑可用**：`ZeKaiNie/universal-examprep-skill`（Exam Cram Coach，398 star，MIT，Python）。
它比我方多三样硬东西：① **只用资料里的真实题出题**（我方是模型自编题）；② **三色溯源标签 + 哈希围栏防注入**；③ **按考试日倒推计划 + 跨会话进度行 + 小抄**。
另有 `open-spaced-repetition/ts-fsrs`（884 star，MIT，TypeScript）是间隔重复算法的正牌实现，但我方 `lib/srs.js` 已有可解释的简版并诚实标注非官方 FSRS，**是否替换走 R/C/N 判定，不默认换**。

关键反幻觉发现：中文文章吹得很猛的两个仓库，GitHub 实际 **AIstudy 2 star / kaoyan408 0 star**；`fsrs.js` README 自己写着已停止主维护、推荐迁移；「考搭子 KaoBuddy」在 GitHub **搜不到**。这些如实记入「未找到」，不拿文章当证据。

---

## 一、三组查询与原始证据

### 组 1 · 中文功能侧（WebSearch）
查询：`复习备考 知识点 题库 思维导图 间隔重复 开源项目 考点大全 错题本 功能`
命中的功能关键词（合并去重）：
- 资料导入拆解：PDF（含扫描件）/DOCX/PPTX/MD/手写图片/字幕 → 知识点 + 难度 + 重要度 + **原文出处**
- 出题：AI 出题 / 组卷刷题 / **导入真题** / 即时批改 / 错题本
- 记忆：SM-2 或 Leitner 8 盒（0/1/2/4/7/15/30/60 天）、闪卡、复习计划
- 规划：按考试日排每日计划、掌握度看板、热力图、薄弱点 TOP N
- 输出：考点大全、小抄（cheat sheet）、模拟考、PDF 导出
- 图片：讲义配图、题目配图、答案配图（考搭子文明确说不做思维导图；Exam Cram Coach 明确做裁图）

### 组 2 · GitHub 开源实现（GitHub API 逐仓库核验）

| 仓库 | star | 语言/协议 | 最近更新 | 逐字符锚点 | 判定 |
|---|---|---|---|---|---|
| `ankitects/anki` | 32931 | Rust / — | 2026-11-20 | 描述原文 "Anki is a smart spaced repetition flashcard program" | 桌面软件，架构基准，不可直接抄 |
| `open-spaced-repetition/ts-fsrs` | 884 | TypeScript / MIT | 2026-11-20 | README 原文 "`ts-fsrs` is a TypeScript toolkit for building spaced repetition systems with FSRS"；支持 FSRS-3/4/4.5/5/6/7 | **可复用（算法库）**，Node≥24 |
| `open-spaced-repetition/fsrs.js` | 180 | JS / MIT | — | README 原文 "we recommend transitioning to `ts-fsrs` … cannot maintain the project" | **已弃用，不选** |
| `open-spaced-repetition/free-spaced-repetition-scheduler` | 738 | Jupyter | 2026-11-19 | 描述 "A spaced repetition algorithm based on DSR model" | 算法论文基准 |
| `ZeKaiNie/universal-examprep-skill` | 398 | Python / MIT | 2026-11-19 | SKILL.md 逐字：quiz "**only with those questions**"；"Show the question figure before asking the question; show the answer figure only when explaining the answer" | **形态最同构，可复用，已真跑** |
| `lynote-ai/ai-tutor` | 151 | Python / — | 2026-11-20 | 描述 "It only teaches a sentence it can quote" | 溯源同理念，未深挖 |
| `didi/xiaoju-survey` | 3803 | TypeScript / — | 2026-11-20 | 问卷/考试平台，非复习闭环 | 不相关，排除 |
| `YYK0402/AIstudy` | **2** | TypeScript / — | 2026-11-07 | WebSearch 文章功能写得很全，GitHub 仅 2 star | **文章与事实不符，只作功能清单** |
| `ozzzzh/kaoyan408` | **0** | TypeScript / — | 2026-11-02 | 同上，0 star | 同上 |
| 「考搭子 KaoBuddy」 | — | — | — | `kaobuddy 考搭子` GitHub 搜索 total_count=0 | **未找到，不采信** |

### 组 3 · 英文 best practice（WebSearch）
查询：`best practice spaced repetition exam preparation software knowledge graph interleaving retrieval practice open source 2025`
三套独立来源一致的三支柱（原文锚点）：
- iatroX：`"spaced repetition, retrieval practice (testing yourself), and interleaving topics are the three pillars of effective, long-term learning"`
- StudyFlow：`"Test yourself before re-reading summaries"`；`"Interleave subjects — don't block-study one topic at a time"`
- Snitchnotes：`"Each review must be a retrieval attempt — you try to produce the answer before checking it"`；`"The retrieval attempt (however uncomfortable) is the mechanism that makes spaced repetition work"`
- Dunlosky et al. 2013（经 Mindomax 转引）：十种学习法只有 **practice testing + distributed practice** 拿到 "high utility"
- Mindomax 对 Knowt 的评价原文：`"does not implement a documented FSRS or SM-2 model, which makes it stronger for short-term exam prep than multi-year retention"` → 调度算法**透明可核验**是加分项

---

## 二、两份基准

### 基准 A · 功能清单（合并中英文，按「资料→理解→检验→记忆→规划」链路）

| # | 能力 | 谁有 | 我方状态 |
|---|---|---|---|
| A1 | 多格式导入（PDF/DOCX/PPTX/MD/图片/字幕） | 全部 | ✅ 已有（PDF/DOCX/PPTX/MD/TXT/图片） |
| A2 | 按章节拆 + 知识点树 + 原文锚点 | Exam Cram / AIstudy / 我方 | ✅ 已有（229 点、章→节→点、P.N/块N） |
| A3 | **真实题反抽自资料**（作业+答案配对、题号识别） | **Exam Cram** | ❌ 我方题目由 LLM 自编，只有 source.quote 逐字校验 |
| A4 | 题型分类 + 分步解答 + 易错点 | 我方 / AIstudy | ✅ 我方更强（solution/rationale/pitfalls 结构化） |
| A5 | 图从资料里抽出、贴到题旁 | **Exam Cram（PDF crop）/ 我方（OOXML 原字节+视觉理解）** | ✅ 各有长短：我方 DOCX/PPTX 原字节更强；**PDF 裁图缺** |
| A6 | 答案图**延迟**到讲解时才出现 | **Exam Cram** | ❌ 我方一进题目卡就全给 |
| A7 | 三色溯源（材料🟢/AI补充🟡/AI编答案⚠️） | **Exam Cram** | ⚠️ 我方只有「原文已核/引文未命中」，不区分 AI 补充 |
| A8 | 提示注入围栏（内容哈希闭合行 + 中英启发式 + 零宽中和） | **Exam Cram** | ❌ 我方 analyze 语料用 `===== 全书内容 =====` 普通分隔，无防注入围栏 |
| A9 | 自动判分（选择/判断/数字/短填空） | **Exam Cram / 我方 core/practice.js** | ✅ 我方已有（parseChoice + verdict） |
| A10 | 间隔重复调度 | Exam Cram( Leitner/SM2 ) / ts-fsrs / 我方 lib/srs.js | ✅ 我方已有简版 FSRS，诚实标注非官方 |
| A11 | 错题本 + 反复错上浮 | AIstudy / Exam Cram / 我方 | ✅ 我方已有（lapseCount 排序 + leech） |
| A12 | **跨会话进度行 + 恢复点** | **Exam Cram（study_state.json + 📍行）** | ⚠️ 我方有 practice.json 状态，但**前端没有"继续上次学到哪"的进度行** |
| A13 | **按考试日倒推每日计划** | **Exam Cram `plan --date` / AIstudy** | ❌ 我方无 |
| A14 | **小抄 cheatsheet** | **Exam Cram / AIstudy** | ❌ 我方无（有 compose 考点大全，但不是极简冲刺小抄） |
| A15 | 掌握度看板/热力图/薄弱点 TOP N | AIstudy / kaoyan408（0 star） | ⚠️ 我方有 summarize，无可视化看板 |
| A16 | 小模型适配（短切片、一次一题、确定性 CLI 输出） | **Exam Cram `--profile small`** | ❌ 我方一次塞 12 万字符语料，小模型必糊 |
| A17 | 互相索引（知识点↔题型↔导图↔考点↔出处） | 我方 | ✅ **我方独有强项**，外部项目没有 |
| A18 | 视觉模型看懂图再配题 / 同字节主图优选 | 我方 | ✅ **我方独有强项** |

### 基准 B · 结构（落盘形态）

Exam Cram 结构（真跑 `setup` 后 `ls` 逐字符）：
```
study_state.json   # 唯一状态：当前章/进度/测验结果/错题/笔记
progress.md, notebook.md
chapters/chNN_title.md        # 带 [file p.N] 锚点的正文
quiz_bank.json                # 每题：答案 + 来源文件/页 + 章 + 配图路径
figures/ + figures.json       # ch03_p12_1.png / hw1solution_q001_ans_1.png
index.json                    # ask 检索块
cheatsheet.md
```
我方结构：`library/books/<id>/{book.json, analysis.json, images.json, images/, practice.json, documents/}` + `core/{capabilities,index,analyze,practice,images,image-vision}.js` + `lib/srs.js`。
**同构点**：都有「一份状态 + 题库 + 图索引 + 长安置文件」；**差异**：对方把「题目图/答案图」在 quiz_bank 里分字段，我方 `imageIds` 不区分题图/答案图。

---

## 三、我方缺什么（按真问题收敛，不列 20 条 nitpick）

只收敛到 **3 条有外部判据、能证伪的真缺口**：

1. **G1 · 题目来源可信度**：我方题目是 LLM 依据 source.quote 自编，quote 逐字校验能挡「原文没这句话」，但挡不住「原文有这句话、题目却是模型自己造的」。Exam Cram 的 `quiz_bank.json` 来自作业/真题文件本身（真跑输出 `题目: 12 (10 有参考答案)`），这是本质差别。**证据**：我方 `analyze.js` SYSTEM_PROMPT 无「只能用资料里已有的题」约束（grep `只用|资料中的题` 无命中）；Exam Cram SKILL.md §5 逐字 `Quiz questions come from the materials; if a chapter has none, you may write practice questions but label them ⚠️ and never call the chapter "verified"`。

2. **G2 · 资料当数据不当指令**：我方把 12 万字符语料包在 `===== 全书内容 =====` 普通分隔里（`analyze.js:253`），资料里若写「忽略之前指令」没有任何机器侧围栏或告警。Exam Cram `coach/guard.py` 逐字符实现 `fence_id = sha256(body)[:6]`、`neutralize()` 中和零宽/伪造闭合、`flagged_lines()` 中英双语正则。**证据**：真跑 `guard.fence(attack)` 输出闭合行只出现 1 次、伪造行被替换为 `[fence-like text removed]`。

3. **G3 · 答案图与进度时机**：我方图片一进题卡就全部显示（`figureStrip` 在题干下、讲解面板也贴），而认知科学判据是 retrieval attempt 必须先于看答案；Exam Cram SKILL.md §4 逐字 `Show the question figure before asking the question; show the answer figure only when explaining the answer`。另外我方没有「继续上次学到哪」的可粘贴进度行（对方每条回复末尾 📍）。

**明确不作为缺口**：间隔重复算法替换（我方已有且诚实标注）、思维导图 UI（外部项目没有，我方更强）、视觉看图配对（我方独有）。

---

## 四、可复用性确认（逐项真跑，不是"看起来能抄"）

| 项 | 确认动作 | 真实输出 | 结论 |
|---|---|---|---|
| Exam Cram 仓库可用 | `git clone --depth 1`（经代理 7890） | `Cloning into 'universal-examprep-skill'...` 完成 | ✅ 可用 |
| 测试套件可信 | `python -m unittest discover -s tests -v` | `Ran 77 tests in 1.176s` / `OK (skipped=4)`（README 写 43，实际 77） | ✅ 可用 |
| guard.py 防注入 | 真跑 `guard.fence(attack)` | 闭合行 count=1；伪造行→`[fence-like text removed]`；`flagged_lines`=[2]；零宽 `MAT\u200bERIAL>>>`→被中和 | ✅ **可直接移植思路** |
| 中文资料拆解 | `coach.py … setup samples/zh-data-structures` | `文件: exam×1, homework×1, lecture×3`；`章节 (3)`；`题目: 12 (10 有参考答案)`；0.0s | ✅ 可用（证明「资料反抽真题」在我方数据形态上可行） |
| 真题出题带围栏 | `coach.py … quiz -n 2` | `q006 … 来源: 期末模拟卷.txt p.1` + `<<<MATERIAL 6c8894 … MATERIAL>>> 6c8894` | ✅ 可用 |
| 跨会话状态 | `coach.py … status`（新进程） | `课程: zh-data-structures … 进度: [░░░░…] 0/3 … 下一步: python coach.py next` | ✅ 可用 |
| 考试日计划 | `coach.py … plan --days 3` | `第 1 天: → ch1 … ch2 …`；`最后一天：复习错题…并生成小抄` | ✅ 可用 |
| ts-fsrs 库 | GitHub API 读 README + 仓库元数据 | 884 star、MIT、FSRS-3…7、Node≥24 | ✅ 可用但**非必需**（见决策表） |
| AIstudy / kaoyan408 | GitHub 仓库查询 | 2 star / 0 star | ⚠️ 只作功能清单，不复用代码 |
| KaoBuddy | GitHub 搜索 | `total_count=0` | ❌ 未找到 |

---

## 五、R/C/N 融合决策表（每条过合理/正确/必要三关）

| 缺口 | 候选融合 | R 合理 | C 正确（锚点） | N 必要（更轻替代？） | 结论 |
|---|---|---|---|---|---|
| G2 注入防护 | 移植 `fence_id + neutralize + flagged_lines` 到 analyze 语料包装 | ✅ 复习工具读的就是不可信讲义 | ✅ guard.py 真跑：闭合 1 次、伪造中和、中英正则 | ✅ 更轻替代「只加一句提示词」挡不住资料内的伪造闭合行 | **融合（P1）** |
| G1 真题来源 | 题目加 `origin: material\|model` 字段 + ⚠️ 标签；不做整套 PDF 作业答案配对 | ✅ 与「不编造」定位一致 | ✅ SKILL.md §5 原文 + 真跑 quiz 来源 p.1 | ✅ 全套反抽要新 parser 且我方资料无作业/答案配对 → 只做轻量标注 | **部分融合（P1，只做标注，不做抽取器）** |
| G3 答案图时机 | 讲解面板「真题长什么样」步骤里的图默认折叠，点「看答案配图」才展开；题干配图保持直显 | ✅ 符合 retrieval-first | ✅ SKILL.md §4 原文 + 三支柱论文 | ✅ 比改图片数据结构轻得多（纯前端） | **融合（P1）** |
| G3 进度行 | 分析/书详情页显示「上次学到：第 N 章 · 错题 M · 下一步」 | ✅ 跨会话痛点真实 | ✅ 真跑 status 输出逐字符 | ⚠️ 我方 practice.json 已有状态，只是没显示 → 只加展示，不加状态机 | **部分融合（P2，只展示已有状态）** |
| A13 考试日计划 | `plan --date` 倒推每日章节 | ⚠️ 用户当前验收标准未提日期规划 | ✅ 真跑 plan 输出 | ❌ 用户明确「不喜功能堆砌」，当前三条标准无此项 | **打回（记入 backlog，不实现）** |
| A14 小抄 | cheatsheet 生成 | ⚠️ 与 compose 考点大全重叠 | ✅ 真跑有 cheatsheet 命令 | ❌ 重叠，加就是堆功能 | **打回** |
| A10 FSRS 替换 | 换 ts-fsrs | ⚠️ 算法更强但需 Node≥24 新依赖 | ✅ README 逐字符 | ❌ 我方已有可解释简版且诚实标注，换它不解决任何当前真问题 | **打回** |
| A5 PDF 裁图 | 加 pypdfium2 裁 PDF 图 | ✅ 我方 PDF 配图确实缺 | ✅ README 真跑 EEC160 235 图 | ❌ 新 Python 依赖 + 我方 Node 栈；且用户当前图需求已在 DOCX/PPTX 满足 | **暂缓（KNOWN-LIMITATION）** |
| A16 小模型 profile | 短切片 profile | ⚠️ | ✅ | ❌ 用户默认用 DeepSeek-V4.1-Flash，当前 12 万字符能跑通 | **打回** |

---

## 六、未找到清单（诚实边界）

- 「考搭子 KaoBuddy」：GitHub 搜索 `total_count=0`，微信文章描述的功能**无法核验代码**，不采信。
- AIstudy(2★) / kaoyan408(0★)：文章功能齐全，但仓库几乎无人使用，**未验证可运行**，只当功能清单。
- 我没有真跑 ts-fsrs 的排程输出（只读 README + 元数据）；「可用」指仓库活跃、许可证 MIT、文档完整，**不等于我方已验证集成**。
- 英文 best practice 里的学习科学结论来自二手转引（iatroX / StudyFlow / Mindomax），未逐篇读 Dunlosky 原论文；只作方向依据，不宣称因果强度。
- PDF 裁图在 Exam Cram 本机真跑时提示 `PDF support: missing → pip install pypdfium2`，样本 UNC 未装该包，故 PDF 裁图**未真机验证**。

---

## 七、真问题清单 + 当前状态（交付纪律）

- **真问题 3 条**：G1 题目来源可信度、G2 资料注入防护、G3 答案图时机/进度行；均有外部逐字符锚点 + 真跑证据。
- **状态（2026-11-20 23:10 更新）**：阶段零 + 阶段一~五均完成。P1 三项已融合落盘：G2→`core/corpus-guard.js` 哈希围栏（真跑伪造闭合行唯一）；G1→题目 `origin=material/model`（只有 verifyQuotes 真命中才算资料原题，老数据会话内回填不写盘）；G3→讲解面板真题配图默认折叠 + 开关（题干配图直显不动）。判别测试 `tools/check-p1-fusion.mjs` baseline 6 红 → candidate 14 绿；真机 SW v19、折叠 hidden=true→点击显示 157px；全量门禁 24/25（唯一红为已知 Node24 undici 退出断言）。
- **G3 进度行**：只融合了「答案图延迟」，「跨会话进度行」按 R/C/N 降为 P2 未做（我方 practice.json 已有状态，只缺展示，当前验收标准没要求）。
- **KNOWN-LIMITATION**：PDF 裁图、考试日计划、小抄、ts-fsrs 替换、小模型 profile 均明确打回或暂缓；下一轮不得擅自加回。
- **围栏的取舍**：`corpus-guard.neutralize()` 会把资料中任何长得像 `MATERIAL>>>` 的文字（含零宽/全角变体）替换成 `[fence-like text removed]`。若教材正文本身在讲 Markdown/围栏语法，该处引文会与原文不一致——这是防注入换来的，且极罕见；真出现时该句引文会显示「引文未命中」，用户看得见，不静默造假。注入告警是启发式，会漏改写攻击、会误报引用了注入句的心理学材料；真正边界是围栏 + 提示词规则，不是检测器。
