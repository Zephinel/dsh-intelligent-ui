# Examples

Six complete programs that the host validator accepts against `vendor/spec.json`. Each one starts with `root`, uses only shipped components and functions, and keeps all state in `$` variables, so it works without another message. They run 15–23 statements: small enough to adapt, large enough to show a real page.

How to use them:

- Pick the example whose **shape** matches the answer, then replace the data, copy and one or two blocks.
- Keep the statement order: `root` first, then `$` declarations, then derived statements, then leaf data. References may point forward, but this order keeps the program readable and matches the injected prompt.
- Every program below has been validated with the same parser the host uses. If you edit one, re-check the rules in [language.md](language.md) and the error strings in [troubleshooting.md](troubleshooting.md).

---

## 1. Two-day city itinerary: photos, map, timeline, checklist (23 statements)

**Style.** Travel/planning page with media, a map, a static timeline and an interactive checklist.

**Teaches.** SearchImage inside a Carousel; Map + MapMarker with a `$` binding and `route`; List with `timeline`; Pressable rows toggling `$done` with `@Toggle`/`@Includes`; Table + `@Sum`; Form + SegmentedControl + `@ToAssistant`.

**Adapt it when.** Any multi-stop plan: trip, conference day, restaurant crawl, apartment hunt. Swap photos, markers and rows; keep the map + timeline + checklist triad.


```openui
root = Col([head, photos, facts, Grid([mapCard, timelineCard], 2, 300, 4), checklistCard, budgetCard, prefs], 5)
$done = []
$selected = "外滩晨走"
$pace = "轻松"
head = Col([Title("上海两日：江边与梧桐区", "2xl"), Text("第一天沿外滩走到南京东路，第二天钻进法租界的梧桐小马路。地图上的 pin 按行程顺序编号，点一下会选中当天起点；清单里的地方打卡后会实时计数。", "md", "muted")], 2)
photos = Carousel([SearchImage("The Bund Shanghai", 1.35), SearchImage("Wukang Road Shanghai", 1.35), SearchImage("Yu Garden Shanghai", 1.35)], 210)
facts = Row([Badge("2 天", "info"), Badge("步行约 12 km"), Badge("预算 ¥3,000", "success"), Badge("11 月最舒服", "purple")], 2, null, null, true)
stops = [{day: "第一天", time: "08:30", title: "外滩晨走", text: "从外白渡桥走到十六铺，人少、光线好。"}, {day: "第一天", time: "14:00", title: "南京东路", text: "逛老字号，拐进福州路看书店。"}, {day: "第二天", time: "09:30", title: "武康路", text: "梧桐树下看老洋房，找一家街角咖啡。"}, {day: "第二天", time: "15:00", title: "豫园", text: "九曲桥和城隍庙小吃，傍晚离开。"}]
markers = [m1, m2, m3, m4]
m1 = MapMarker("外滩晨走", 31.2410, 121.4900, "第一天", "🌅")
m2 = MapMarker("南京东路", 31.2370, 121.4750, "第一天", "🛍️")
m3 = MapMarker("武康路", 31.2110, 121.4380, "第二天", "☕")
m4 = MapMarker("豫园", 31.2270, 121.4920, "第二天", "🏮")
mapCard = Card([Row([Title("地图", "sm"), Spacer(), Caption("路线按顺序连接")]), Map(markers, true, $selected, 240)], "outline")
timelineCard = Card([Title("时间线", "sm"), List([t1, t2, t3, t4], "none", true)], "outline")
t1 = ListItem("外滩晨走", "从外白渡桥走到十六铺。", "08:30")
t2 = ListItem("南京东路", "老字号与福州路书店。", "14:00")
t3 = ListItem("武康路", "梧桐树下的老洋房与咖啡。", "09:30")
t4 = ListItem("豫园", "九曲桥和城隍庙小吃。", "15:00")
checklistCard = Card([Row([Title("打卡清单", "sm"), Spacer(), Caption(@Count($done) + " / " + @Count(stops) + " 已完成")]), Col(@Each(stops, "s", Pressable([Row([Icon(@Includes($done, s.title) ? "check-circle" : "circle", "sm", @Includes($done, s.title) ? "success" : "faint"), Col([Text(s.title, "sm", null, "semibold", false, @Includes($done, s.title)), Caption(s.day + " · " + s.time)], 0)], 3, "start")], @Set($done, @Toggle($done, s.title)), @Includes($done, s.title), 2)), 1), Button("清空打卡", @Reset($done), "ghost", null, "sm", "rotate-ccw")], "outline")
budget = [1200, 900, 300, 600]
budgetCard = Card([Title("预算（两人）", "sm"), Table(["项目", "金额"], [["住宿", "¥1,200"], ["餐饮", "¥900"], ["交通", "¥300"], ["门票与咖啡", "¥600"]]), Row([Text("合计"), Spacer(), Title("¥" + @Format(@Sum(budget), "number"), "lg")])], "outline")
prefs = Card([Title("按你的节奏再排一次", "sm"), Form([SegmentedControl($pace, ["轻松", "紧凑"], true), Button("让助手调整", @ToAssistant("按" + $pace + "的节奏调整这两天的上海行程，预算约 ¥3,000。"), "solid", null, "sm", "sparkles")])], "soft")
```

---

## 2. Working calculator: sliders, segmented control, chart, timer (23 statements)

**Style.** Inputs drive computed figures and a chart; everything runs locally.

**Teaches.** `$` bindings as the source of truth; derived statements (`coffee`, `water`, `ratio`); Grid of stat cards; Chart from a computed array; Timer with a reset Button; Celebration when the timer reaches 0; @CopyToClipboard.

**Adapt it when.** Any parameter calculator: recipe scaling, loan estimate, unit conversion, dose calculator, budget split. Replace the formulas and keep the control → figure → chart → action loop.


```openui
root = Col([title, intro, controls, figures, poursCard, timerCard, stepsCard, footer, party], 5)
$cups = 2
$strength = "平衡"
$left = 30
title = Title("手冲咖啡配方计算器", "2xl")
intro = Text("拖动杯数、切换浓度，配方、粉水比和注水曲线会立刻重算；闷蒸计时器直接在页面里倒计时。全部计算都在你的浏览器本地完成。", "md", "muted")
controls = Card([Col([Label("杯数"), Slider($cups, 1, 6, 1, "几人份", "杯"), SegmentedControl($strength, ["轻盈", "平衡", "浓郁"], true)], 3)], "outline")
light = $strength == "轻盈" ? 17 : 15
ratio = $strength == "浓郁" ? 13 : light
coffee = @Round($cups * 15)
water = @Round(coffee * ratio)
figures = Grid([Card([Caption("咖啡豆"), Title(coffee + " g", "xl"), Text("每杯 15 g", "sm", "muted")], "soft"), Card([Caption("总水量"), Title(water + " g", "xl"), Text("粉水比 1:" + ratio, "sm", "muted")], "soft"), Card([Caption("水温"), Title("92 °C", "xl"), Text("浅烘可以再高 2 度", "sm", "muted")], "soft")], 3, 140, 3)
p1 = @Round(water * 0.2)
p2 = @Round(water * 0.3)
p3 = @Round(water * 0.3)
p4 = @Round(water - p1 - p2 - p3)
pours = [{label: "闷蒸", value: p1}, {label: "第一次", value: p2}, {label: "第二次", value: p3}, {label: "收尾", value: p4}]
poursCard = Card([Title("分段注水", "sm"), Chart("bar", pours, "label", ["value"], "number")], "outline")
timerCard = Card([Row([Timer($left, "秒"), Spacer(), Button("重置 30 秒", @Set($left, 30), "ghost", null, "sm", "rotate-ccw")], 3)], "outline")
steps = ["用热水温杯，然后倒掉", "磨豆：中细，像细砂糖", "注入 " + p1 + " g 水，闷蒸 30 秒", "分三次注完剩下的 " + (water - p1) + " g，总时长约 2 分 30 秒"]
stepsCard = Card([Title("冲煮步骤", "sm"), List(steps, "number")], "outline")
footer = Row([Button("复制配方", @CopyToClipboard("手冲 " + $cups + " 杯：咖啡豆 " + coffee + " g，水 " + water + " g，粉水比 1:" + ratio), "outline", null, "sm", "copy"), Button("换一种交互例子", @ToAssistant("用 render_ui 再给我一个不同风格的交互页面例子"), "soft", null, "sm", "sparkles")], 2)
party = Celebration($left == 0)
```

---

## 3. Svg step-by-step tutorial with a step switcher (15 statements)

**Style.** A how-to page where every step is a hand-drawn Svg, not a photo.

**Teaches.** Four Svg drawings built from Rect/Line/Polygon/Path/SvgText; `$step` driving the viewer with a ternary; Button actions clamped with `@Clamp`; thumbnail strip made of Pressable tiles via `@Each(@Range(0, n), ...)`; Celebration on the last step.

**Adapt it when.** Assembly instructions, knots and folds, a machine or mechanism, geometry, a room/garden layout. Draw simple shapes with a wide viewBox (about 240) and label them with SvgText.


```openui
root = Col([head, materials, viewer, strip, tip, footer, party], 5)
$step = 0
materials = Row([Badge("A4 纸 1 张", "info"), Badge("不用剪刀"), Badge("约 3 分钟", "success")], 2, null, null, true)
head = Col([Title("十分钟折一架飞得远的纸飞机", "2xl"), Text("换一种画风：这一页全是 Svg 手绘步骤图，没有照片和地图。点缩略图或按钮切步骤，看完最后一步会撒花。", "md", "muted")], 2)
steps = [{title: "对折出中线", text: "A4 纸竖放，左右对折出一条中线，压出折痕后展开。"}, {title: "折出尖顶", text: "左上、右上两个角分别折向中线，上边与中线对齐，形成一个尖顶。"}, {title: "再折一次", text: "把新形成的斜边再次折向中线，尖头变长；翻面后同样处理背面。"}, {title: "机身与机翼", text: "沿中线对折机身，把机翼向下折，再把机翼后缘向上折 3 mm，完成。"}]
s0 = Svg([Rect(76, 20, 88, 156, "surface", "ink", 2), Line(120, 20, 120, 176, "faint", 1), SvgText("对折", 120, 192, 11, "muted", "middle")], "0 0 240 206")
s1 = Svg([Rect(76, 20, 88, 156, "surface", "ink", 2), Polygon("76,20 120,20 120,64", "#e7f0fc"), Polygon("164,20 120,20 120,64", "#e7f0fc"), Line(120, 64, 120, 176, "faint", 1), SvgText("两角向中线折", 120, 192, 11, "muted", "middle")], "0 0 240 206")
s2 = Svg([Polygon("120,20 164,20 120,84", "#e7f0fc", "ink", 1.5), Polygon("120,20 76,20 120,84", "surface", "ink", 1.5), Line(120, 84, 120, 168, "ink", 1.5), SvgText("再折一次", 120, 190, 11, "muted", "middle")], "0 0 240 204")
s3 = Svg([Polygon("120,26 62,96 120,154", "surface", "ink", 2), Polygon("120,26 178,96 120,154", "#e7f0fc", "ink", 2), Line(120, 26, 120, 154, "muted", 1), Line(62, 96, 178, 96, "muted", 1), Line(16, 56, 44, 70, "info", 2), Line(10, 88, 38, 94, "info", 2), SvgText("完成 · 试飞", 120, 176, 11, "info", "middle")], "0 0 240 192")
drawings = [s0, s1, s2, s3]
viewer = Card([Row([Badge("步骤 " + ($step + 1) + " / 4", "info"), Spacer(), Caption(@Percent($step + 1, 4) + "% 完成")], 2), Box([drawings[$step]], null, null, 3, "surface", "lg"), Title(steps[$step].title, "md"), Text(steps[$step].text, "sm"), Row([Button("上一步", @Set($step, @Clamp($step - 1, 0, 3)), "outline", null, null, "arrow-left", $step == 0), Spacer(), Button("下一步", @Set($step, @Clamp($step + 1, 0, 3)), "solid", null, null, "arrow-right", $step == 3)], 2)], null, 4, 3)
strip = Grid(@Each(@Range(0, 4), "i", Pressable([drawings[i], Caption((i + 1) + ". " + steps[i].title)], @Set($step, i), i == $step, 2)), 4, 96, 2)
tip = Card([Row([Icon("lightbulb", "sm"), Text("机翼后缘向上折 3 mm，飞机就会爬升；重心太靠后会打转，把机头捏紧一点。", "sm")], 2)], "soft")
footer = Row([Button("复制折法", @CopyToClipboard("纸飞机：对折出中线 → 两顶角折向中线 → 再折一次 → 对折机身 → 折出机翼（后缘上折 3 mm）"), "outline", null, "sm", "copy"), Button("再教我折一架", @ToAssistant("再教我折一架飞得更远的纸飞机，每一步配 Svg 图。"), "soft", null, "sm", "sparkles")], 2)
party = Celebration($step == 3)
```

---

## 4. Dashboard over inline rows: KPIs, trend, donut, table (23 statements)

**Style.** Data page with a filter that recomputes every figure.

**Teaches.** Inline row objects with dates and numbers; `$region` filter with `@Filter`; KPI cards built from `@Sum`/`@Count`/`@Avg`/`@Change`; `@Bucket` for a weekly series; `@GroupBy` for the donut; `@Sort`/`@Take` into a Table; `@Between` + `@Format` for date ranges and money.

**Adapt it when.** Sales/ops dashboards, study trackers, expense reports. Replace `orders` with the rows the user gave you; keep the KPI → trend → breakdown → detail table order.


```openui
root = Col([head, kpis, Grid([trendCard, regionCard], 2, 300, 4), tableCard, note], 5)
$region = "全部"
orders = [{date: "2026-07-03", region: "North", product: "Espresso machine", amount: 1290}, {date: "2026-07-06", region: "South", product: "Grinder", amount: 420}, {date: "2026-07-11", region: "East", product: "Espresso machine", amount: 1180}, {date: "2026-07-15", region: "North", product: "Milk pitcher", amount: 85}, {date: "2026-07-19", region: "South", product: "Filter brewer", amount: 560}, {date: "2026-07-24", region: "East", product: "Grinder", amount: 460}, {date: "2026-07-28", region: "North", product: "Espresso machine", amount: 1420}, {date: "2026-08-02", region: "South", product: "Espresso machine", amount: 1330}, {date: "2026-08-06", region: "East", product: "Scale", amount: 130}, {date: "2026-08-10", region: "North", product: "Grinder", amount: 480}, {date: "2026-08-13", region: "South", product: "Filter brewer", amount: 620}, {date: "2026-08-18", region: "East", product: "Espresso machine", amount: 1490}, {date: "2026-08-21", region: "North", product: "Milk pitcher", amount: 95}, {date: "2026-08-25", region: "South", product: "Scale", amount: 140}, {date: "2026-08-28", region: "East", product: "Grinder", amount: 520}, {date: "2026-08-31", region: "North", product: "Espresso machine", amount: 1610}]
filtered = $region == "全部" ? orders : @Filter(orders, "region", "==", $region)
head = Row([Col([Title("销售看板 · 2026 年 7–8 月", "xl"), Text("切换区域，KPI、趋势、占比和明细会一起重算。", "sm", "muted")], 1), Spacer(), SegmentedControl($region, ["全部", "North", "South", "East"])], 3, "end", "between", true)
revenue = @Sum(filtered.amount)
count = @Count(filtered)
avg = @Round(@Avg(filtered.amount))
august = @Sum(@Between(filtered, "date", "2026-08-01", "2026-08-31").amount)
july = @Sum(@Between(filtered, "date", "2026-07-01", "2026-07-31").amount)
change = @Change(august, july)
kpis = Grid([k1, k2, k3, k4], 4, 140, 3)
k1 = Card([Caption("营收"), Title(@Format(revenue, "currency", 0, "USD"), "xl")], "soft")
k2 = Card([Caption("订单"), Title(@Format(count), "xl")], "soft")
k3 = Card([Caption("客单价"), Title(@Format(avg, "currency", 0, "USD"), "xl")], "soft")
k4 = Card([Caption("8 月环比"), Title(change == null ? "-" : (change > 0 ? "+" : "") + @Format(change, "number", 1) + "%", "xl", change == null ? "muted" : change > 0 ? "success" : "danger")], "soft")
trend = @Bucket(filtered, "date", "week", "amount")
byRegion = @GroupBy(orders, "region", "amount")
trendCard = Card([Title("每周营收", "sm"), @Count(trend) == 0 ? Text("这个区域还没有数据。", "sm", "muted") : Chart("line", trend, "key", ["value"], "currency", "USD", false, 220)], "outline")
regionCard = Card([Title("区域占比", "sm"), Chart("donut", byRegion, "key", ["value"], "currency", "USD", false, 220)], "outline")
topRows = @Each(@Take(@Sort(filtered, "amount", "desc"), 6), "o", [o.product, Badge(o.region, "info"), @Format(o.amount, "currency", 0, "USD")])
tableCard = Card([Row([Title("金额最高的订单", "sm"), Spacer(), Caption("按金额降序，最多 6 行")]), @Count(filtered) == 0 ? Text("没有匹配的订单。", "sm", "muted") : Table(["产品", "区域", "金额"], topRows)], "outline")
note = Text("数据是演示用的静态数组；筛选、分组和汇总全部在浏览器本地用 @functions 完成。", "xs", "muted")
```

---

## 5. Form + live preview + @ToAssistant submit (17 statements)

**Style.** A planner form whose values are previewed live and sent as one follow-up request.

**Teaches.** Form grouping; Input, DatePicker, Select, Slider and TextArea bound to `$` variables; a disabled submit gated on `nameOk`; `@Format`/`@FormatDate`/`@Plural` for display; `@Reset`; a `@ToAssistant` message composed from the field values.

**Adapt it when.** Intake forms, quote requests, custom plans, settings. Note that in this deployment only the message string reaches the composer, so concatenate the values the follow-up needs into the message.


```openui
root = Col([head, formCard, previewCard, note], 5)
$name = ""
$people = 4
$date = "2026-11-08"
$pace = "balanced"
$budget = 4000
$notes = ""
head = Col([Title("定制你的周末计划", "xl"), Text("填好偏好后提交，助手会按人数、日期、节奏和预算排一份完整行程。左边（窄屏时在下方）的预览会随输入实时更新。", "md", "muted")], 2)
nameOk = $name != ""
formCard = Card([Title("你的偏好", "md"), Form([Grid([Input($name, "称呼", "text", "怎么称呼你"), Input($people, "人数", "number")], 2, 200, 4), Grid([DatePicker($date, "出发日期", "2026-11-01", "2026-12-31"), Select($pace, [{value: "relaxed", label: "轻松"}, {value: "balanced", label: "平衡"}, {value: "active", label: "紧凑"}], "节奏")], 2, 200, 4), Slider($budget, 1000, 10000, 500, "人均预算", "¥"), TextArea($notes, "其他偏好", "例如：想看展、不吃辣、带小孩…", 3), Button("生成我的周末计划", @ToAssistant("帮我排一个周末计划：" + $people + " 人，" + $date + " 出发，" + $pace + " 节奏，人均预算 ¥" + $budget + ($notes == "" ? "" : "，其他偏好：" + $notes) + "。"), "solid", null, "lg", "send", !nameOk, true)])], "outline")
r1 = Row([Caption("称呼"), Spacer(), Text(nameOk ? $name : "还没填", "sm", null, "medium")])
r2 = Row([Caption("人数"), Spacer(), Text($people + " 人", "sm")])
r3 = Row([Caption("出发"), Spacer(), Text(@FormatDate($date, "long"), "sm")])
r4 = Row([Caption("节奏"), Spacer(), Text($pace == "relaxed" ? "轻松" : $pace == "active" ? "紧凑" : "平衡", "sm")])
r5 = Row([Caption("人均预算"), Spacer(), Text(@Format($budget, "currency", 0, "CNY"), "sm")])
previewCard = Card([Row([Title("实时预览", "sm"), Spacer(), Badge(nameOk ? "可以提交" : "请先填称呼", nameOk ? "success" : "warning")]), r1, r2, r3, r4, r5, Divider(), Button("清除全部", @Reset($name, $people, $date, $pace, $budget, $notes), "ghost", null, "sm", "rotate-ccw")], "soft")
note = Text("提交按钮只把这一句请求发回助手；页面上的预览和格式化都靠 $ 变量与 @functions 本地完成。", "xs", "muted")
```

---

## 6. Flashcard quiz with scoring and an HtmlView mini-game (17 statements)

**Style.** Learning page: flip cards, answered questions, a score bar, and a sandboxed canvas game.

**Teaches.** Flashcard deck in a Carousel; RadioGroup answers with per-answer feedback; a score computed from `$` state; progress bar drawn with nested Box; Celebration when every answer is right; HtmlView for a self-contained canvas game; `@CopyToClipboard` and `@ToAssistant`.

**Adapt it when.** Quizzes, training drills, language practice, onboarding. Keep the game inside one HtmlView string; do not try to share state between the iframe and the page.


```openui
root = Col([head, cards, quizCard, resultCard, gameCard, footer, party], 5)
$a1 = ""
$a2 = ""
head = Col([Title("咖啡冲煮小测", "2xl"), Text("先点开三张翻面卡复习，再答两道题。答对两题会撒花；页面底部还有一个 15 秒的接豆子小游戏。", "md", "muted")], 2)
cards = Carousel([f1, f2, f3], 230, 3)
f1 = Flashcard("20 g 咖啡粉，1:15 的粉水比要多少水？", "300 g 水。把 20 乘以 15 就得到总水量。", "粉水比")
f2 = Flashcard("手冲浅烘豆，水温大概多少？", "92–94 °C；深烘豆可以降到 88–90 °C。", "水温")
f3 = Flashcard("闷蒸一般要多久？", "约 30 秒，让咖啡粉排掉二氧化碳。", "闷蒸")
quizCard = Card([Title("两道题", "md"), q1, Divider(), q2], "outline")
q1 = Col([RadioGroup($a1, [{value: "a", label: "1:10"}, {value: "b", label: "1:15"}, {value: "c", label: "1:20"}], "20 g 咖啡粉配 300 g 水，粉水比是？", "pills"), $a1 == "" ? Caption("选一个答案。") : Text($a1 == "b" ? "**答对了。** 300 ÷ 20 = 15。" : "**再想想。** 用总水量除以粉量。", "sm", $a1 == "b" ? "success" : "warning")], 2)
q2 = Col([RadioGroup($a2, [{value: "a", label: "88 °C"}, {value: "b", label: "96 °C"}, {value: "c", label: "92 °C"}], "浅烘豆建议的水温？", "pills"), $a2 == "" ? Caption("选一个答案。") : Text($a2 == "c" ? "**答对了。** 浅烘用 92–94 °C 更稳。" : "**再想想。** 浅烘豆需要更高一点的水温。", "sm", $a2 == "c" ? "success" : "warning")], 2)
score = ($a1 == "b" ? 1 : 0) + ($a2 == "c" ? 1 : 0)
resultCard = Card([Row([Icon(score == 2 ? "party-popper" : "target", "sm", score == 2 ? "success" : "info"), Text("得分 " + score + " / 2" + (score == 2 ? "，两道都答对了。" : "，答完两道题再看看结果。"), "sm", null, "semibold")]), Box([Box([], null, null, null, "success", "full", null, (score / 2 * 100) + "%", 6)], null, null, null, "surface", "full", null, "100%", 6), Button("重做", @Reset($a1, $a2), "ghost", null, "sm", "rotate-ccw")], "soft")
game = "<style>body{display:flex;flex-direction:column;gap:8px;padding:10px;font:13px/1.4 system-ui;margin:0}#b{display:flex;justify-content:space-between}canvas{width:100%;height:190px;border-radius:12px;background:#f4efe6;touch-action:none;cursor:crosshair}button{font:inherit;padding:6px 14px;border:0;border-radius:999px;background:#5b3a1e;color:#fff;cursor:pointer;align-self:flex-start}</style><div id='b'><span id='s'>得分 0</span><span id='t'>点开始</span></div><canvas id='c'></canvas><div><button id='g'>开始 15 秒</button></div><script>const c=document.getElementById('c'),x=c.getContext('2d');let p={x:.5,y:.5,vx:.004,vy:.003},s=0,end=0,raf;function fit(){c.width=c.clientWidth;c.height=c.clientHeight}function draw(){fit();x.clearRect(0,0,c.width,c.height);x.fillStyle='#b5651d';x.beginPath();x.arc(p.x*c.width,p.y*c.height,15,0,7);x.fill()}function tick(){const l=Math.max(0,end-Date.now());document.getElementById('t').textContent=(l/1000).toFixed(1)+' s';p.x+=p.vx;p.y+=p.vy;if(p.x<.05||p.x>.95)p.vx*=-1;if(p.y<.08||p.y>.92)p.vy*=-1;draw();if(l>0)raf=requestAnimationFrame(tick);else document.getElementById('t').textContent='结束，得分 '+s}c.addEventListener('pointerdown',e=>{if(Date.now()>end)return;const r=c.getBoundingClientRect(),dx=(e.clientX-r.left)/r.width-p.x,dy=(e.clientY-r.top)/r.height-p.y;if(Math.hypot(dx*r.width,dy*r.height)<28){s++;document.getElementById('s').textContent='得分 '+s;p.x=.1+Math.random()*.8;p.y=.15+Math.random()*.7;p.vx=(Math.random()-.5)*.02;p.vy=(Math.random()-.5)*.02}});document.getElementById('g').onclick=()=>{s=0;document.getElementById('s').textContent='得分 0';end=Date.now()+15000;cancelAnimationFrame(raf);tick()};draw()</script>"
gameCard = Card([Row([Title("接豆子", "sm"), Spacer(), Caption("15 秒 · 沙盒 iframe")]), Text("躲开的豆子不算分；点中一颗得一分。游戏状态留在 iframe 内，不会影响上面的小测。", "sm", "muted"), HtmlView(game, 300, "接豆子小游戏")], "outline")
footer = Row([Button("复制粉水比口诀", @CopyToClipboard("1:15 = 20 g 粉配 300 g 水；浅烘 92–94 °C；闷蒸 30 秒。"), "outline", null, "sm", "copy"), Button("再出两道题", @ToAssistant("再出两道手冲咖啡的选择题，用 render_ui 做成可交互页面。"), "soft", null, "sm", "sparkles")], 2)
party = Celebration(score == 2)
```

---
