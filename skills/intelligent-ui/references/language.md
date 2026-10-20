# OpenUI Lang: syntax, state and actions

A complete program is **one page**, written as statements. It is not HTML, not React and not a template language: you declare named values and components, and the renderer draws the component at `root` with the data those names resolve to. Read this file before writing anything longer than a stat block; it is the difference between a page that renders and one the validator rejects.

## 1. Statements

- One statement per line: `name = expression`. Blank lines are ignored.
- `root` is the entry point. It must exist, evaluate to a component, and by convention it is the first line.
- Names are identifiers (`head`, `mapCard`, `t1`). `$name` declares reactive state instead of an ordinary statement (section 4).
- `//` and `#` start a line comment; the parser strips them before reading statements.
- Statements are declarations, not execution steps: there is no `if`, `for`, `return`, assignment or function definition. Conditions are ternaries; repetition is `@Each`.
- Every statement except `root` must be **reachable** from `root` (directly or through other statements). An unreachable statement is dropped: the host returns the warning `Unreferenced statement (will not render): <name>` and the page renders without it.

Minimal valid program:

```openui
root = Col([head, list])
$done = []
head = Row([Title("Packing", "xl"), Spacer(), Caption(@Count($done) + " / 3")])
list = Col(@Each(items, "i", Pressable([Text(i, "sm")], @Set($done, @Toggle($done, i)), @Includes($done, i), 2)), 1)
items = ["Passport", "Charger", "Adapter"]
```

Note that `head` references `$done` and `items` is defined last: the parser resolves the whole program before evaluating, so order is a readability choice, not a semantic requirement.

## 2. Expressions

| You can write | Example |
| --- | --- |
| String | `"外滩 · 08:30"`, escapes: `\"`, `\\`, `\n` |
| Number | `42`, `0.15`, `-3` |
| Boolean / null | `true`, `false`, `null` |
| Array | `[1, 2, 3]`, `["a", "b"]`, `[m1, m2]` |
| Object | `{name: "Espresso", amount: 1290}` (bare keys) |
| Reference | `head`, `$people`, `rows` |
| Member access | `order.amount`, `steps[$step].title` |
| Index | `$people[0]`, `drawings[$step]` |
| Array pluck | `rows.amount` → every `amount` value |
| Arithmetic | `+ - * / %`, e.g. `@Round($cups * 15)` |
| Comparison | `== != > < >= <=` (numbers and strings; `>`/`<` are numeric) |
| Logical | `&& \|\| !` |
| Ternary | `$left == 0 ? "Ready" : "Steeping"` |
| Parentheses | `(a + b) * c` |
| Function call | `@Sum(rows.amount)`, `@Format($total, "currency", 2, "USD")` |
| Component call | `Title("Hi", "lg")` |

Rules that bite:

- **No string interpolation.** `"Total: ${$total}"` renders the literal text `${$total}`. Use concatenation: `"Total: " + @Format($total, "currency")`.
- **`+` concatenates when either side is a string**, and adds when both are numbers. Numbers do not coerce automatically where a string is required: `Title(42)` fails with `field "/text" expects string but got number`; write `Title(42 + "")` or `Title(@Format(42))`.
- **No named arguments.** Every argument is positional (see section 6).
- **Only the listed `@functions` exist.** There is no `@If`, `@Map`, `@Length`, `@Mean` or `@FormatNumber`; use ternary, `@Each`, `@Count`, `@Avg`, `@Format`.
- **Conditional components are ternaries**: `$on ? Card([...]) : null`. A `null` child renders nothing.

## 3. References and hoisting

References may point **forward**: use a name before its statement. The parser resolves all references after reading the whole program, so hoisting always works and order never changes the result. Write structure first anyway: the injected prompt models programs that way, and a page whose shell is at the top is easier to scan and repair. In this deployment the card renders from the complete program at the end of the turn, so do not rely on a half-written program being visible.

Two different "missing" states matter:

- `Unresolved reference: X` — a name was used that no statement declares. This is a **warning**, not fatal; the component receives `null` and part of the page silently disappears. Treat it as a bug.
- `Unreferenced statement (will not render): X` — a statement is declared but nothing reachable from `root` uses it. Also a warning; the work is wasted.

Both warnings appear in the tool result. A successful `render_ui` can still return warnings — fix them and re-call rather than shipping a half-finished page.

## 4. `$` state

State is the only mutable thing on the page. Declare it with a literal default:

```openui
$people = 4
$done = []
$mode = "全部"
$items = [{name: "Espresso machine", amount: 1290}]
```

- `$name` values are client-local. Each rendered page starts from its declared defaults; state changes never travel back to the model. Put anything the assistant must know into a `@ToAssistant` message.
- Declare defaults as **literals** (number, string, boolean, array, object). Derived values belong in ordinary statements: `total = @Sum($items.amount)`.
- An undeclared `$var` is auto-created as `null`, but declare every binding anyway so the component gets a correctly typed value.
- Components with a `$binding` read and write the variable in place: `Slider($budget, 0, 10000, 500, "Budget", "$")`.
- `Map`'s `selected` is also a binding (holds the clicked marker label); `Timer`'s first argument is a binding (it counts down in place).
- Change state only through actions: `@Set($people, $people + 1)`, `@Reset($people)`. An expression or `Text` cannot mutate state.
- List editing is functional — the helpers return a **copy**:
  - `@Append($list, item)` / `@Prepend($list, item)` / `@Concat($a, $b)`
  - `@Remove($list, field, value)` (use `""` for a plain list) / `@RemoveAt($list, index)`
  - `@Update($list, field, value, setField, setValue)`
  - `@Toggle($list, item)` and `@Includes($list, item)` for sets of strings/numbers
- `@Random`, `@Pick` and `@Shuffle` draw a new value on every evaluation. Call them inside `@Set` so a click draws once: `Button("Roll", @Set($roll, @Random(1, 6, true)))`.

## 5. Actions

An **action expression** turns a click into behaviour. It is meaningful only where a component expects one: the second argument of `Button` / `IconButton`, and the second argument of `Pressable`; anywhere else it is parsed but never runs.

```openui
one = Button("Reset", @Reset($c, $i, $g))
several = Button("Start over", Action([@Set($step, 0), @Reset($done, $note)]))
```

- Single step: pass it bare (`@Set(...)`). Several steps: `Action([step, step, ...])`; steps run in order.
- `Action` is language syntax, not a component — never put it alone in a children array.
- A Button whose action is `null` (or omitted) sends its **label** as a follow-up message automatically. That is fine for "Plan another day"; it is wrong for "Reset".
- Action steps:

| Step | Use |
| --- | --- |
| `@Set($var, value)` | Write one state variable; the workhorse for tabs, toggles, counters, selections. |
| `@Reset($a, $b, ...)` | Restore declared defaults. |
| `@ToAssistant(message, context?)` | Send a short first-person follow-up to the assistant. |
| `@OpenUrl(url)` | Open an http(s) URL in a new tab; other schemes are ignored. |
| `@CopyToClipboard(text)` | Copy text; build it with `@Join` for lists. |

- `@ToAssistant` is the only path back to the model, and each call starts a new turn. Reserve it for what the page cannot compute: a form submit, a request for a new plan, a deeper explanation. Keep the message short and first-person, like the user typed it.
- **This deployment forwards only the message string** from `@ToAssistant`; the optional `context` object is parsed but not delivered. If the next turn needs a field value, concatenate it into the message: `@ToAssistant("Plan for " + $people + " people on " + $date)`.
- Clicks are the only event. There is no hover, keypress, drag or scroll handler; `Slider`/`Input` already update their binding as the user moves them.

## 6. Components as values, children and arguments

- A component call is an expression: `Title("Hi", "lg")`. It can be stored in a statement, put inline in a children array, or returned by a ternary or `@Each`.
- Children arguments are arrays of nodes. They may contain components, strings (where the component allows text), nested arrays, and `null`:
  - `Col(["plain text", Text("styled", "sm")])` works where a text child is allowed, but prefer components for styled content.
  - `$show ? Card([...]) : null` renders nothing when hidden.
- Prefer **references for blocks** (`mapCard`, `timelineCard`) and inline calls for leaves. References keep the root short and the page easier to repair.
- Arguments are positional. Skipping a middle optional argument requires `null`: `Row([a, b], 3, null, null, true)`.
- A component's first argument may itself be a binding (`$` variable) — that is what makes inputs work.
- Exact signatures live in [components.md](components.md); argument order and enum values are enforced, and an unknown extra argument is fatal.

## 7. `@Each` and data shapes

`@Each(array, "loopVar", template)` maps rows to values. The loop variable exists **only inside the template expression**, because the template is evaluated per element; extracting it to a statement loses the binding.

Right:

```openui
rows = [{name: "Espresso machine", amount: 1290}, {name: "Grinder", amount: 420}]
cards = Grid(@Each(rows, "o", Card([Title(o.name, "sm"), Text(@Format(o.amount, "currency"))])), 2, 240, 3)
```

Wrong:

```openui
row = Card([Title(o.name, "sm")])          // o is undefined here
cards = Grid(@Each(rows, "o", row), 2)      // renders empty cards
```

Useful patterns:

- **Build derived rows once, reuse them**: `lines = @Each(items, "i", {name: i.name, qty: i.qty * $guests})`, then `@Each(lines, "l", ...)`, `Table(...)`, `@Sum(lines.qty)`.
- **Repeat n times**: `@Each(@Range(0, 4), "i", Pressable([...stops[i]...], @Set($step, i)))`.
- **Nested loops** are allowed: `@Each(groups, "g", Col([Title(g.title), @Each(g.items, "i", Text(i))]))`.
- **Object templates** create plain rows (not components) for charts and tables: `@Each(rows, "r", {label: r.name, value: r.amount})`.
- **Conditional rows inside a template**: `@Each(rows, "r", r.amount > 0 ? Row([...]) : null)`.

## 8. Functions

- Calls are `@Name(args)`. They compose: `@Format(@Sum(rows.amount), "currency", 0, "USD")`, `@Count(@Filter(rows, "status", "==", "open"))`.
- Array pluck: `rows.amount` extracts the field from every row, so `@Sum(rows.amount)` needs no `@Each`.
- Rows returning objects (`@GroupBy`, `@Bucket`, `@Histogram`) have `{key, value}` fields ready for `Chart` with `x = "key"` and `series = ["value"]`.
- Display formatting is part of the language, not the data: keep numbers numeric until render (`@Format(value, "currency", 0, "USD")`, `@Format(value, "percent", 1)`) and build counts with `@Plural`.
- The full list, with signatures, is the catalog in [components.md](components.md#core-functions-14) and [components.md](components.md#library-functions-59).

## 9. Statement order and streaming

The host parses the **whole program** before it renders; hoisting means statement order never changes the result. Two things still make order matter for humans and for the model:

1. `root` first, exactly as the injected prompt expects — it names the page shell before anything else and makes the program easy to scan.
2. `$` declarations next, then component statements, then the large data literals last. A long inline array at the top pushes the interesting structure out of view and makes repairs harder.

The full rules for hoisting are in section 3.

## 10. Wrong vs right

**Named arguments** — colon syntax happens to parse as an object, then fails confusingly:

```openui
// wrong — error mentions the first required field
root = Col(children: [Text("hi")])
// right
root = Col([Text("hi")])
```

**Assumed components/functions**:

```openui
// wrong — unknown component "Segmented"
root = Col([Segmented("mode", ["a", "b"])])
// right
root = Col([SegmentedControl($mode, ["a", "b"])])

// wrong — unknown function "@Length"
Text(@Length(rows) + "")
// right
Text(@Count(rows) + "")
```

**Conditional rendering** — there is no `@If`; ternary or null:

```openui
// wrong
root = Col([@If($on, Card([Text("on")]))])
// right
root = Col([$on ? Card([Text("on")]) : null])
```

**State defaults** — keep declarations literal; derive afterwards with a normal statement:

```openui
// avoid — the declaration is meant to be the starting value, not a computation
$items = [{amount: 1}, {amount: 2}]
$total = @Sum($items.amount)
// right
$items = [{amount: 1}, {amount: 2}]
total = @Sum($items.amount)
```

**Mutating outside an action** — a misplaced action step parses but never becomes an interaction:

```openui
// avoid — @Set in a text position evaluates to null and no click can reach it
root = Col([Text(@Set($n, 1))])
// right — state changes live on a clickable component
root = Col([Button("Set", @Set($n, 1)), Text($n + "")])
```

**Numbers where strings are required**:

```openui
// wrong — "field /text expects string but got number"
root = Col([Title(42, "xl")])
// right
root = Col([Title(42 + "", "xl")])
```

**Dates compared with `<`** — comparison operators are numeric; `@DaysBetween` orders dates:

```openui
// wrong — treated as a string/number comparison
$isFuture = $date > @Today()
// right
$isFuture = @DaysBetween(@Today(), $date) > 0
```

**Unreachable or unresolved names** — warnings that silently damage the page:

```openui
// warnings: unresolved "missingMap", unreferenced "extraCard"
root = Col([head, missingMap])
head = Title("Hi", "xl")
extraCard = Card([Text("never shown")])
// right: reference every block you need, from root
root = Col([head, mapCard])
mapCard = Card([Map([m1], false)])
m1 = MapMarker("外滩", 31.2410, 121.4900)
```

**Re-computing display text by hand** — use the formatting functions:

```openui
// wrong — raw float in the UI
Text("$" + $total)
// right
Text(@Format($total, "currency", 2, "USD"))
```

## 11. Pre-flight checklist

Before calling `render_ui`, verify:

1. `root` is the first line and is a component call.
2. Every referenced name is declared; every declared component statement is reachable from `root`.
3. Every `$` variable used as a binding is declared with a sensible literal default.
4. Every interactive control has a visible effect: it changes what the page renders, or it is inside a `Form` with a submit action. No dead inputs.
5. Every enum value, argument count and component name matches [components.md](components.md).
6. Money, percentages, counts and dates shown as text use `@Format`/`@Plural`/`@FormatDate`; computed values are derived with `@functions`, not hardcoded.
7. The program is complete: no `...`, no placeholder comments, no "TODO".
