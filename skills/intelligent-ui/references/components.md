# Components, functions and actions

Complete reference for the OpenUI Lang vocabulary this extension ships: **55 components**, **59 library `@functions`**, **14 core `@functions`** (73 callable in total) and **5 action steps**. Signatures and descriptions are generated from `vendor/spec.json`, the build-time source of the component spec that the host validator enforces (the spec is compiled into `lib/index.js`; `vendor/` is not shipped). A component or argument not listed here does not exist at runtime.

> The plugin already injects these signatures into the system prompt. Read this file when you need the grouped notes, an optional argument you have not used, or the full function table in one place.

## Reading a signature

- Arguments are **positional**: `Card(children, variant, padding, gap)`. There is no named-argument syntax; `Card(children: [...])` is parsed as a single object argument and fails.
- `?` marks an optional argument. Omit optional arguments from the **end**; pass `null` as a placeholder to skip one in the middle (`Row(children, 3, null, null, true)`).
- `Node[]` is an array of components; `Node[] | string` also accepts strings. `null` inside a children array renders nothing, which is how you write a conditional block: `$ok ? null : Text("…")`.
- `$binding<T>` means a `$variable` reference; the component reads and writes it in place. Declare it with a literal default: `$people = 4`, then `Input($people, "People", "number")`.
- `ActionExpression` accepts one action step (`@Set(...)`) or `Action([...])` for several. `Action` is language syntax, not a component; do not put it alone in a children array.

**Token types**

- **Color**: `"ink"`, `"muted"`, `"faint"`, `"canvas"`, `"on-ink"`, `"info"`, `"success"`, `"warning"`, `"danger"`, `"purple"`, `"pink"`, `"chart1"`…`"chart6"`, or any CSS color. As a background, status colors are soft tints; as text/stroke they are strong. `"surface"`, `"surface-strong"` and `"border"` are surface/paint tokens — use them as backgrounds or SVG fills, never as text/icon colors (they are washes and would vanish). A background of `"ink"` is an inverted fill and a background of `"chart1"`…`"chart6"` is a solid brand fill: in both cases their content switches to a readable color automatically, so leave child text colors unset (or use `"on-ink"`).
- **Radius**: `"sm"`, `"md"`, `"lg"`, `"xl"`, `"full"`, or a pixel number.
- **Length**: a pixel number or a CSS length string such as `"100%"`.
- **Spacing**: every `gap` and `padding` argument counts **4px steps** (`gap: 3` = 12px). Inner gap 1–2, group gap 3–4, section gap 5–6. Do not use one gap everywhere.

**Rules that apply to every component**

- Component names are case-sensitive: `Title`, not `title`; `SegmentedControl`, not `Segmented`.
- Enums are exact strings: `Title("x", "giant")` fails; the error lists the allowed values.
- Never add an argument that is not in the signature: extra arguments are a fatal error (`Text takes 8 arg(s), got 9`).
- A component used at the root must be a component call, and the convention is `root = Col([...])`.

## Layout (9 components)

### `Col`

```
Col(children: Node[], gap?: number, align?: "start" | "center" | "end" | "stretch")
```

Vertical layout. Without gap it spaces blocks like an article.

**Notes.** Children stack vertically. On the page root, leave `gap` unset so blocks space like an article; set it only when grouping related blocks.

### `Row`

```
Row(children: Node[], gap?: number, align?: "start" | "center" | "end" | "stretch", justify?: "start" | "center" | "end" | "between", wrap?: boolean)
```

Horizontal layout; items are vertically centered.

**Notes.** Horizontal flex row; set `wrap` for badge rows that may not fit. Use `Spacer()` to push items apart.

### `Box`

```
Box(children?: Node[], direction?: "row" | "col", gap?: number, padding?: number, background?: Color, radius?: Radius, border?: boolean, width?: Length, height?: Length, flex?: number, align?: "start" | "center" | "end" | "stretch", justify?: "start" | "center" | "end" | "between", wrap?: boolean)
```

Flex container, a column by default. radius also clips the content.

**Notes.** Also the way to draw a bar or swatch: give it `background`, `radius`, `height` and `width`. `flex` distributes width inside a Row. `radius` clips children.

### `Grid`

```
Grid(children: Node[], columns?: number, minChildWidth?: number, gap?: number)
```

Equal columns (default 2). With minChildWidth (px), columns drop on narrow screens.

**Notes.** Equal columns, default 2. `minChildWidth` (px) lets columns drop on the narrow chat card — prefer it over a fixed column count for anything wide.

### `Card`

```
Card(children: Node[], variant?: "outline" | "soft", padding?: number, gap?: number)
```

Panel with a border; soft is a filled panel for summaries.

**Notes.** Group one block. `soft` for summaries, `outline` for content. Cards inside a Grid should carry the same blocks in the same order.

### `Carousel`

```
Carousel(children: Node[], itemWidth?: number, gap?: number)
```

Horizontal row that scrolls and snaps, each child an item itemWidth px wide (default 240): photos, cards, options, days.

**Notes.** Horizontal snap-scrolling row: photos, choices, days. Each child becomes one item `itemWidth` px wide (default 240).

### `Popover`

```
Popover(trigger: string | Node[], content: string | Node[])
```

Shows content in a small panel when the trigger is clicked: a definition, a source, details behind an Icon("info", "sm").

**Notes.** Keep the trigger short (an icon or a word); put the aside in the content. Good for sources, definitions and caveats.

### `Divider`

```
Divider()
```

**Notes.** A horizontal rule. No arguments.

### `Spacer`

```
Spacer()
```

Fills the free space in a Row.

**Notes.** Fills the free space in a Row; put it between items you want pushed apart.

## Text (12 components)

### `Title`

```
Title(text: string, size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl", color?: Color)
```

Heading; md for a card title, lg for a section, 2xl for a big number.

**Notes.** Page title `xl`/`2xl`; card or block title `md`/`sm`. Inside a Card, display sizes use a capped scale — `lg` 18px, `xl` 22px, `2xl` 26px, `3xl` 30px — so `xl` reads as a big number (a KPI) without turning the panel into a page; use it for one number, not for the card heading.

### `Text`

```
Text(text: string | Node[], size?: "xs" | "sm" | "md" | "lg", color?: Color, weight?: "normal" | "medium" | "semibold", italic?: boolean, lineThrough?: boolean, tabularNums?: boolean, maxLines?: number)
```

Paragraph; supports **bold**, *italic*, `code` and [links](https://…). text may be a list mixing strings and inline components: [Icon("clock", "sm"), " 25 min · ", Badge("Easy")].

**Notes.** Body copy. `text` may be a list mixing strings and inline components: `[Icon("clock", "sm"), " 25 min · ", Badge("Easy")]`.

### `Caption`

```
Caption(text: string, color?: Color)
```

Small secondary text.

**Notes.** Small secondary text: labels, units, image captions, footnotes.

### `Label`

```
Label(text: string)
```

Field or group label.

**Notes.** A field or group label above an input.

### `Badge`

```
Badge(text: string, color?: "neutral" | "info" | "success" | "warning" | "danger" | "purple" | "pink", icon?: string)
```

Pill tag; icon is an optional leading lucide name.

**Notes.** Quick facts and status. `icon` is a lucide name. Facts are Badges, not Buttons.

### `Link`

```
Link(text: string, url: string)
```

Opens an http(s) URL in a new tab.

**Notes.** External links only; non-http(s) URLs render as text.

### `List`

```
List(items: (string | ListItem)[], marker?: "bullet" | "number" | "none", timeline?: boolean)
```

timeline joins the markers with a line.

**Notes.** Static list. `marker` is "bullet", "number" or "none"; `timeline` joins markers with a line and pairs well with time markers on ListItem.

### `ListItem`

```
ListItem(title: string, description?: string, marker?: string, children?: Node[])
```

marker replaces the bullet or number, e.g. a time or an emoji.

**Notes.** One list entry. `marker` replaces the bullet with a string (a time, an emoji); `children` adds blocks under the description.

### `Markdown`

```
Markdown(text: string)
```

Prose with headings, lists, quotes, code and tables.

**Notes.** Prose with headings, lists, quotes, tables and code fences. Use for long-form notes; build UI with components, not Markdown.

### `Quote`

```
Quote(text: string, cite?: string)
```

A quotation or a callout with a side rule; cite names the source.

**Notes.** A callout with a side rule; `cite` names the source.

### `Code`

```
Code(code: string, language?: string)
```

Code block with a copy button.

**Notes.** Read-only code block with a copy button.

### `Math`

```
Math(tex: string, inline?: boolean)
```

LaTeX formula, e.g. Math("E = mc^2"); inline true to sit in a Text list.

**Notes.** KaTeX formula. `inline: true` to sit inside a Text `text` list.

## Inputs (13 components)

### `Button`

```
Button(label: string, action?: ActionExpression, variant?: "solid" | "outline" | "soft" | "ghost", color?: "primary" | "danger" | "success", size?: "sm" | "md" | "lg", icon?: string, disabled?: boolean, block?: boolean)
```

icon is a lucide name.

**Notes.** No action sends the label as a follow-up (`@ToAssistant(label)` equivalent). Use `block` for a full-width submit, `disabled` for gating.

### `IconButton`

```
IconButton(icon: string, action?: ActionExpression, label?: string, variant?: "outline" | "ghost" | "solid")
```

Round icon-only button; label is read aloud.

**Notes.** Round icon-only button. `label` is the accessible name and the confirmation tooltip — always give one.

### `Pressable`

```
Pressable(children: Node[], action?: ActionExpression, selected?: boolean, padding?: number, background?: Color, radius?: Radius)
```

Makes any content clickable, such as a tile or a swatch.

**Notes.** Makes arbitrary content clickable: tiles, checklist rows, swatches. `selected` draws the selection ring.

### `Input`

```
Input(value: $binding<string | number>, label?: string, type?: "text" | "number", placeholder?: string)
```

Text or number field; a number field stores numbers.

**Notes.** Text or number field bound to `$var`; a number field stores numbers. Guard counts with `@Default`/`@Clamp` before dividing.

### `TextArea`

```
TextArea(value: $binding<string>, label?: string, placeholder?: string, rows?: number)
```

**Notes.** Multi-line text bound to `$var`.

### `Select`

```
Select(value: $binding<string>, options: (string | {value: string, label: string})[], label?: string, placeholder?: string)
```

Dropdown, for long option lists.

**Notes.** Dropdown for long option lists; options are strings or `{value, label}` objects.

### `SegmentedControl`

```
SegmentedControl(value: $binding<string>, options: (string | {value: string, label: string})[], block?: boolean)
```

2 to 4 short choices in a row.

**Notes.** 2–4 short choices in a row; the fastest way to switch what the page shows.

### `Slider`

```
Slider(value: $binding<number>, min: number, max: number, step?: number, label?: string, unit?: string, marks?: {value: number, label: string}[])
```

Shows label and value; unit like "%" or "$" formats the value.

**Notes.** Numeric range bound to `$var`. `unit` formats the value ("%", "$", " kg"); `marks` labels positions.

### `Checkbox`

```
Checkbox(checked: $binding<boolean>, label: string, lineThrough?: boolean)
```

lineThrough strikes the label when checked, for to-do lists.

**Notes.** Boolean bound to `$var`; `lineThrough` strikes the label like a to-do list.

### `RadioGroup`

```
RadioGroup(value: $binding<string>, options: (string | {value: string, label: string, description?: string})[], label?: string, variant?: "list" | "pills" | "cards")
```

pills for short choices; cards for choices that need a description line.

**Notes.** Exclusive choice. `pills` for short options, `cards` when each option needs a description.

### `DatePicker`

```
DatePicker(value: $binding<string>, label?: string, min?: string, max?: string)
```

Dates are "YYYY-MM-DD".

**Notes.** Date bound to `$var` as "YYYY-MM-DD"; `min`/`max` constrain the range.

### `Timer`

```
Timer(seconds: $binding<number>, label?: string)
```

Countdown with start, pause and reset. It counts the bound seconds down to 0, so other statements can react, e.g. $left == 0.

**Notes.** Countdown over the bound seconds; start/pause/reset are built in. Other statements can react, e.g. `$left == 0`.

### `Form`

```
Form(children: Node[])
```

Groups fields; their values go with any @ToAssistant inside.

**Notes.** Groups fields for a submit Button. See the deployment note in [troubleshooting.md](troubleshooting.md) for how @ToAssistant forwards values here.

## Media and data (8 components)

### `SearchImage`

```
SearchImage(query: string, aspectRatio?: number, radius?: Radius, fit?: "cover" | "contain")
```

A real photo the app finds for query; it needs no URL and no tool. Name the exact thing in 2 to 4 words: "Belém Tower Lisbon", "iPhone 17", "pastel de nata". Use one for every place, dish, product or thing with a look.

**Notes.** A real photo found by the app. Name the exact subject in 2–4 words; there is no URL and no tool call. Offline it degrades to an icon placeholder.

### `Image`

```
Image(src: string, alt: string, aspectRatio?: number, radius?: Radius, fit?: "cover" | "contain")
```

Photo from a URL the user or a tool gave; if it fails, a photo is found for alt.

**Notes.** Photo from a URL the user or a tool gave; if it fails, the app searches by `alt`.

### `Icon`

```
Icon(name: string, size?: "sm" | "md" | "lg" | "xl", color?: Color)
```

Lucide icon by name, e.g. "map-pin".

**Notes.** Lucide icon by exact name (kebab-case), e.g. "map-pin", "sparkles". An unknown name renders nothing.

### `Table`

```
Table(columns: string[], rows: any[][])
```

Each row lists its cells in column order; a cell may be a component. Number columns align right.

**Notes.** Rows are cell arrays in column order; a cell may be a component (Badge, Text). Number columns right-align.

### `Chart`

```
Chart(type: "bar" | "line" | "area" | "pie" | "donut" | "scatter", data: Record<string, string | number>[], x?: string, series?: string[], format?: "number" | "currency" | "percent", currency?: string, stacked?: boolean, height?: number)
```

Rows of data; x is the category key (a number key for scatter), series the value keys (default: every number key). percent values are like 45; currency is a code like "EUR".

**Notes.** Rows of `{xKey: category, seriesKey: number}`. `x` names the category key, `series` the value keys (default: every number key), `format` "number"|"currency"|"percent", `stacked` for bars/areas, `height` in px.

### `Map`

```
Map(markers: MapMarker[], route?: boolean, selected?: $binding<string>, height?: number)
```

Street map fitted to its markers. route draws the road path in marker order; selected holds the clicked marker's label.

**Notes.** Needs MapMarker children. `route` draws a street route in marker order; `selected` is a `$` binding holding the clicked label. Tiles or routing failing degrades to a place list/direct lines.

### `MapMarker`

```
MapMarker(label: string, lat: number, lng: number, category?: string, icon?: string)
```

A place on a Map; icon is one emoji, else the pin shows its number.

**Notes.** A pin: label, lat, lng, optional category, optional emoji icon. Numbered pins are drawn with a digit.

### `YouTube`

```
YouTube(video: string, title?: string)
```

Embedded YouTube video by id or URL. Only a video you know exists.

**Notes.** Embed by video id or URL. Only videos that are known to exist.

## Play (2 components)

### `Flashcard`

```
Flashcard(front: string | Node[], back: string | Node[], hint?: string)
```

Card that flips between front and back when tapped. Put several in a Carousel or Grid.

**Notes.** Tap to flip. Put several in a Carousel or Grid for a deck. `hint` shows before the flip.

### `Celebration`

```
Celebration(when: boolean)
```

Bursts confetti when its condition turns true, e.g. Celebration($score == 5) at the end of a quiz.

**Notes.** Confetti when its condition turns true, e.g. `Celebration($score == 5)`. One per page.

## Drawing (11 components)

### `Svg`

```
Svg(children: Node[], viewBox: string, width?: Length, height?: Length)
```

A drawing for steps, parts, mechanisms, diagrams and layouts. Scales to its width; its shapes take expressions, so state can move them.

**Notes.** Scaled drawing canvas. `viewBox` like "0 0 240 160"; shapes take expressions, so state can move them.

### `G`

```
G(children: Node[], transform?: string, opacity?: number)
```

Group; transform like "rotate(30 50 50)" or "translate(10 0)".

**Notes.** SVG group; `transform` like "rotate(30 90 80)" or "translate(10 0)".

### `Circle`

```
Circle(cx: number, cy: number, r: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
```

**Notes.** SVG circle: center (cx, cy), radius r.

### `Ellipse`

```
Ellipse(cx: number, cy: number, rx: number, ry: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
```

**Notes.** SVG ellipse: center, radii rx/ry.

### `Rect`

```
Rect(x: number, y: number, width: number, height: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number, rx?: number)
```

**Notes.** SVG rectangle; `rx` rounds the corners.

### `Line`

```
Line(x1: number, y1: number, x2: number, y2: number, stroke?: Color, strokeWidth?: number, opacity?: number)
```

**Notes.** SVG line from (x1, y1) to (x2, y2).

### `Path`

```
Path(d: string, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
```

**Notes.** SVG path data (`d`), e.g. "M 10 80 Q 60 20 120 80".

### `Polyline`

```
Polyline(points: string, stroke?: Color, strokeWidth?: number, fill?: Color, opacity?: number)
```

points like "0,0 10,5 20,0".

### `Polygon`

```
Polygon(points: string, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
```

**Notes.** SVG closed polygon; use a small triangle as an arrow head.

### `SvgText`

```
SvgText(text: string, x: number, y: number, size?: number, fill?: Color, anchor?: "start" | "middle" | "end", weight?: "normal" | "medium" | "semibold")
```

**Notes.** SVG label at (x, y); `anchor` "start"|"middle"|"end", `size` in viewBox units.

### `HtmlView`

```
HtmlView(html: string, height?: number, title?: string)
```

Sandboxed HTML page with inline JS, for games and canvas. No network except script CDNs. Fits its content unless height is set.

**Notes.** The iframe has an opaque origin (no access to the chat or its storage), its CSP allows inline code, a few script/style/font CDNs and https images, but no other network. Its height is clamped to 80–2400 px, and it mounts once the program has finished arriving.

## Core `@functions` (14)

Provided by the language runtime; available everywhere. Data functions compose: `@Round(@Avg(rows.score), 1)`.

| Function | Signature | Use |
| --- | --- | --- |
| `@Count` | `Count(array: any[]) → number` | Number of items, e.g. `@Count($items)` or `@Count(@Filter(rows, "status", "==", "open"))`. |
| `@First` | `First(array: any[]) → any` | First item of an array, or null for an empty array. |
| `@Last` | `Last(array: any[]) → any` | Last item of an array, or null for an empty array. |
| `@Sum` | `Sum(numbers: number[]) → number` | Total of a number array; array pluck makes `@Sum(rows.amount)` work. |
| `@Avg` | `Avg(numbers: number[]) → number` | Mean of a number array. |
| `@Min` | `Min(numbers: number[]) → number` | Smallest number in an array. |
| `@Max` | `Max(numbers: number[]) → number` | Largest number in an array. |
| `@Sort` | `Sort(array: any[], field: string, direction?: "asc" \| "desc") → any[]` | Copy sorted by one field; direction defaults to "asc". |
| `@Filter` | `Filter(array: any[], field: string, operator: "==" \| "!=" \| ">" \| "<" \| ">=" \| "<=" \| "contains", value: any) → any[]` | Rows matching a field condition. `>`/`<` compare numbers only, so filter dates by string equality or use `@Between`. |
| `@Round` | `Round(number: number, decimals?: number) → number` | Round to N decimals (default 0). |
| `@Abs` | `Abs(number: number) → number` | Absolute value. |
| `@Floor` | `Floor(number: number) → number` | Round down to a whole number. |
| `@Ceil` | `Ceil(number: number) → number` | Round up to a whole number. |
| `@Each` | `Each(array: any[], varName: string, template: any) → any[]` | Map items to a template. The loop variable exists ONLY inside the template expression — inline it. |

## Library `@functions` (59)

Shipped with this component library (generated from `vendor/spec.json`). These are the ONLY functions available beyond the core set — you cannot define your own.

| Function | Signature | Use |
| --- | --- | --- |
| `@Append` | `Append(list: any[], item: any) → any[]` | Copy of the list with item added at the end |
| `@Prepend` | `Prepend(list: any[], item: any) → any[]` | Copy of the list with item added at the start |
| `@Concat` | `Concat(list: any[], more: any[]) → any[]` | Joins two lists |
| `@Remove` | `Remove(list: any[], field: string, value: any) → any[]` | Copy without the items whose field equals value; field "" compares the items themselves |
| `@RemoveAt` | `RemoveAt(list: any[], index: number) → any[]` | Copy without the item at index (0-based; negative counts from the end) |
| `@Update` | `Update(list: any[], field: string, value: any, setField: string, setValue: any) → any[]` | Copy where items whose field equals value get setField set to setValue |
| `@Toggle` | `Toggle(list: any[], item: any) → any[]` | Adds item if missing, removes it if present (a set of strings or numbers) |
| `@Includes` | `Includes(list: any[] \| string, item: any) → boolean` | True if the list has item, or the text contains it |
| `@Find` | `Find(list: any[], field: string, value: any) → any` | First item whose field equals value, or null |
| `@IndexOf` | `IndexOf(list: any[], item: any) → number` | Index of item in the list, or -1 |
| `@Take` | `Take(list: any[], n: number) → any[]` | The first n items; a negative n takes the last n |
| `@Slice` | `Slice(list: any[] \| string, start: number, end?: number) → any[] \| string` | Items, or characters of text, from start up to end (not included); negative counts from the end |
| `@Unique` | `Unique(list: any[]) → any[]` | Distinct items in first-seen order |
| `@Reverse` | `Reverse(list: any[]) → any[]` | Copy in reverse order |
| `@Range` | `Range(start: number, end: number, step?: number) → number[]` | Numbers from start up to end (not included) by step (default 1), e.g. @Range(0, 3) is [0, 1, 2] |
| `@Pick` | `Pick(list: any[]) → any` | A random item, or null for an empty list; draws anew each time, so call it inside @Set |
| `@Shuffle` | `Shuffle(list: any[]) → any[]` | Copy in random order; call it inside @Set |
| `@Flatten` | `Flatten(list: any[]) → any[]` | One list from a list of lists, e.g. [[1, 2], [3]] is [1, 2, 3] |
| `@Chunk` | `Chunk(list: any[], size: number) → any[][]` | The list cut into lists of size items, e.g. for weeks of 7 days or pages |
| `@Pow` | `Pow(base: number, exponent: number) → number` | base raised to exponent |
| `@Sqrt` | `Sqrt(number: number) → number` | Square root; null for a negative number |
| `@Random` | `Random(min: number, max: number, integer?: boolean) → number` | Random number from min to max (integer true: a whole number, max included); draws anew each time, so call it inside @Set |
| `@Clamp` | `Clamp(number: number, min: number, max: number) → number` | number kept between min and max |
| `@Percent` | `Percent(part: number, total: number) → number` | part / total * 100, e.g. @Percent(3, 4) is 75; 0 when total is 0 |
| `@Lerp` | `Lerp(a: number, b: number, t: number) → number` | The value a fraction t of the way from a to b |
| `@Allocate` | `Allocate(total: number, weights: number[], decimals?: number) → number[]` | Splits total in proportion to weights, rounded to decimals (default 2), so the parts add up to exactly total, e.g. @Allocate(100, [1, 1, 1]) is [33.34, 33.33, 33.33] |
| `@Payment` | `Payment(principal: number, rate: number, periods: number) → number` | Payment per period that repays principal over periods at rate percent per period, e.g. a 30-year loan at 6% a year: @Payment(300000, 6 / 12, 360) |
| `@Convert` | `Convert(value: number, from: string, to: string) → number` | value from one unit to another: mm cm m km in ft yd mi; mg g kg oz lb st; ml l tsp tbsp floz cup pt qt gal (US); m/s km/h mph kn; m2 km2 ft2 ha acre; c f k |
| `@Format` | `Format(value: number, kind?: "number" \| "currency" \| "percent" \| "compact", decimals?: number, currency?: string) → string` | Number as text: "number" 12,345.6, "currency" $12,345.68 (currency is a code like "EUR"), "percent" 45 -> 45%, "compact" 1.2M ($1.2M with a currency) |
| `@Join` | `Join(list: any[], sep?: string, field?: string) → string` | Joins the items (or their field) into text with sep (default ", "), skipping nulls |
| `@Plural` | `Plural(n: number, word: string, plural?: string) → string` | Count and word: @Plural(1, "guest") is "1 guest", 3 gives "3 guests"; plural defaults to word + "s" |
| `@Pad` | `Pad(value: string \| number, length: number, char?: string) → string` | Pads the start of value to length with char (default "0"), e.g. 7 -> "07" |
| `@Upper` | `Upper(text: string) → string` | Text in upper case |
| `@Lower` | `Lower(text: string) → string` | Text in lower case |
| `@Trim` | `Trim(text: string) → string` | Text without spaces at the start and end |
| `@Capitalize` | `Capitalize(text: string) → string` | Each word with a capital first letter, e.g. "new york" is "New York" |
| `@Split` | `Split(text: string, sep?: string) → string[]` | List of the parts of text between sep (default ","), each trimmed, empty parts dropped, e.g. @Split("a, b,,c") is ["a", "b", "c"] |
| `@Replace` | `Replace(text: string, find: string, replacement: string) → string` | Text with every find replaced by replacement |
| `@Duration` | `Duration(seconds: number, style?: "short" \| "clock") → string` | Seconds as text: "short" 1h 20m, 4m 05s, 45s (default); "clock" 1:20:00, 4:05 |
| `@Default` | `Default(value?: any, fallback: any) → any` | value, or fallback when value is null, "" or not a number, e.g. an empty number input: @Default($weight, 0) |
| `@MixColor` | `MixColor(from: string, to: string, t: number) → string` | The hex color a fraction t of the way from one hex color to another, e.g. @MixColor("#ffffff", "#0285ff", 0.5) for a heatmap or a tint |
| `@Now` | `Now() → string` | The current date and time as an ISO string |
| `@Today` | `Today() → string` | Today's date in the viewer's time zone, as "YYYY-MM-DD" |
| `@FormatDate` | `FormatDate(date: string \| number, style?: "date" \| "short" \| "long" \| "weekday" \| "month" \| "time" \| "datetime" \| "iso") → string` | A date as text: "date" Oct 9, 2026 (default), "short" Oct 9, "long" Friday, October 9, 2026, "weekday" Fri, "month" Oct 2026, "time" 9:30 PM, "datetime", "iso" 2026-10-09. Dates are "YYYY-MM-DD", ISO or a timestamp |
| `@AddDays` | `AddDays(date: string \| number, days: number) → string` | The date days later (negative: earlier), as "YYYY-MM-DD" |
| `@AddMonths` | `AddMonths(date: string \| number, months: number) → string` | The date months later (negative: earlier), kept within the month (Jan 31 + 1 is Feb 28), as "YYYY-MM-DD"; 12 months is a year |
| `@DaysBetween` | `DaysBetween(from: string \| number, to: string \| number) → number` | Calendar days from one date to another (negative if to is earlier) |
| `@MonthsBetween` | `MonthsBetween(from: string \| number, to: string \| number) → number` | Whole months from one date to another (negative if to is earlier); @Floor(@MonthsBetween(birthday, @Today()) / 12) is an age |
| `@StartOf` | `StartOf(date: string \| number, unit: "week" \| "month" \| "year") → string` | First day of the date's "week" (Monday), "month" or "year", as "YYYY-MM-DD" |
| `@GroupBy` | `GroupBy(rows: any[], key: string, field?: string, agg?: "sum" \| "avg" \| "count" \| "min" \| "max") → {key: string \| number, value: number}[]` | One row per distinct key, in first-seen order; value is agg of field (default "sum"), or the row count without a field |
| `@Pivot` | `Pivot(rows: any[], rowKey: string, colKey: string, field?: string, agg?: "sum" \| "avg" \| "count" \| "min" \| "max") → Record<string, string \| number>[]` | One row per rowKey value with a column per colKey value holding agg of field, for stacked or grouped charts |
| `@Top` | `Top(rows: any[], field: string, n: number, direction?: "desc" \| "asc") → any[]` | The n rows with the largest field ("asc": the smallest) |
| `@Between` | `Between(rows: any[], field: string, min?: any, max?: any) → any[]` | Rows whose field is from min to max, both included; compares numbers, or text such as "YYYY-MM-DD" dates. Leave min or max null for an open end |
| `@Bucket` | `Bucket(rows: any[], dateField: string, unit: "day" \| "week" \| "month", field?: string, agg?: "sum" \| "avg" \| "count" \| "min" \| "max") → {key: string \| number, value: number}[]` | Rows per day, week (from Monday) or month of dateField, in date order, empty periods 0 for sum and count; key is "YYYY-MM-DD", or "YYYY-MM" for months |
| `@Cumulative` | `Cumulative(rows: any[], field: string) → any[]` | Copy of the rows with field replaced by its running total (field "" for a list of numbers) |
| `@MovingAvg` | `MovingAvg(rows: any[], field: string, window: number) → any[]` | Copy of the rows with field replaced by the average of its last window values (field "" for a list of numbers) |
| `@Change` | `Change(current: number, previous: number) → number` | Percent change from previous to current, e.g. @Change(120, 100) is 20; null when previous is 0 |
| `@Histogram` | `Histogram(values: number[], bins: number, min?: number, max?: number) → {key: string, value: number, start: number, end: number}[]` | Counts numbers into equal-width bins (value is the count); min and max fix the range, default the data's |
| `@Stats` | `Stats(values: number[]) → {count: number, min: number, max: number, mean: number, median: number, stdev: number}` | Summary of numbers, all zeros for an empty list |

### Function families at a glance

- **Shape rows**: `@Filter`, `@Sort`, `@Top`, `@Between`, `@Take`, `@Slice`, `@Unique`, `@Reverse`, `@Flatten`, `@Chunk`, `@GroupBy`, `@Pivot`, `@Bucket` → pass the result straight to `@Each`, `Table`, `Chart`, `@Sum`.
- **Aggregate**: `@Count`, `@Sum`, `@Avg`, `@Min`, `@Max`, `@Stats`, `@Change`, `@Percent`, `@Allocate`, `@Cumulative`, `@MovingAvg`, `@Histogram`.
- **Lists**: `@Append`, `@Prepend`, `@Concat`, `@Remove`, `@RemoveAt`, `@Update`, `@Toggle`, `@Includes`, `@Find`, `@IndexOf`.
- **Text**: `@Format`, `@Plural`, `@Join`, `@Split`, `@Replace`, `@Pad`, `@Upper`, `@Lower`, `@Trim`, `@Capitalize`, `@Duration`.
- **Time**: `@Today`, `@Now`, `@FormatDate`, `@AddDays`, `@AddMonths`, `@DaysBetween`, `@MonthsBetween`, `@StartOf`.
- **Math/color**: `@Round`, `@Abs`, `@Floor`, `@Ceil`, `@Pow`, `@Sqrt`, `@Random`, `@Clamp`, `@Lerp`, `@Payment`, `@Convert`, `@MixColor`.
- **Choice**: `@Pick` (one random item), `@Shuffle` (random order). Both draw fresh on every evaluation, so call them only inside `@Set`.
- **Coercion**: `@Default(value, fallback)` for empty number inputs; `@Join(array, sep, field)` to make text; `@Format` to display numbers as money/percent.

## Action steps (5)

Actions wire user gestures to behaviour. Pass one bare step to an action argument, or several in `Action([...])`; steps run in order.

| Step | Signature | Effect |
| --- | --- | --- |
| `@ToAssistant` | `message: string, context?: any` | Send a short first-person follow-up message; this deployment seeds and submits the composer with the message text. Use only for what the page cannot compute. |
| `@OpenUrl` | `url: string` | Open an http(s) URL in a new tab; non-http(s) values are ignored. |
| `@Set` | `variable: $variable, value: any` | Write a `$` variable (the in-page interaction workhorse). |
| `@Reset` | `variable: $variable, ...` | Restore one or more `$` variables to their declared defaults. |
| `@CopyToClipboard` | `text: string` | Copy text (join a list with `@Join`); falls back to execCommand when the Clipboard API is unavailable. |

- `@ToAssistant` closes the loop back to the model; everything else runs locally in the browser with no round trip.
- A Button whose second argument is `null` sends its label to the assistant automatically. Use `null` when the label is the whole request ("Plan another day"), otherwise give an explicit action.
- `@CopyToClipboard` is the only library action; `@Set`, `@Reset`, `@ToAssistant` and `@OpenUrl` are language builtins.
- Do not fake state changes: a Button that changes what the page shows must use `@Set`/`@Reset`.
