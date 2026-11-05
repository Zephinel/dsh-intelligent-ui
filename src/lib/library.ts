import { createLibrary } from "@openuidev/react-lang";
import { actions } from "./actions";
import { functions } from "./functions";
import "./components/theme.css";
import "./components/components.css";
import "./components/map/map.css";
import { Chart } from "./components/chart";
import { Carousel, Celebration, Code, Flashcard, MathBlock, Popover, Quote, YouTube } from "./components/extra";
import {
  Button,
  Checkbox,
  DatePicker,
  IconButton,
  Input,
  Pressable,
  RadioGroup,
  SegmentedControl,
  Select,
  Slider,
  TextArea,
  Timer,
} from "./components/controls";
import { HtmlView } from "./components/html-view";
import { Box, Card, Col, Divider, Form, Grid, Row, Spacer } from "./components/layout";
import { Section, Toc } from "./components/article";
import { MapMarker, MapView } from "./components/map/map";
import { Icon, Image, SearchImage } from "./components/media";
import { svgComponents } from "./components/svg";
import { Table } from "./components/table";
import { Badge, Caption, Label, Link, List, ListItem, Markdown, Text, Title } from "./components/text";
import { BlockSlot, wrapNestedContainer, type NestedContainerComponent } from "./components/block-slot";

/** The model-facing component catalog, in prompt order. */
const components = [
  Col, Row, Box, Grid, Card, Carousel, Popover, Divider, Spacer, Section, Toc,
  Title, Text, Caption, Label, Badge, Link, List, ListItem, Markdown, Quote, Code, MathBlock,
  Button, IconButton, Pressable, Input, TextArea, Select, SegmentedControl, Slider, Checkbox, RadioGroup, DatePicker, Timer, Form,
  SearchImage, Image, Icon, Table, Chart, MapView, MapMarker, YouTube,
  Flashcard, Celebration,
  ...svgComponents, HtmlView,
];

/** Prompt groups; the internal block wrapper is deliberately absent. */
const componentGroups = [
    {
      name: "Layout",
      components: ["Col", "Row", "Box", "Grid", "Card", "Carousel", "Popover", "Divider", "Spacer", "Section", "Toc"],
      notes: [
        '- gap and padding count 4px steps. Length is px or a CSS length like "50%". Radius is "sm", "md", "lg", "xl", "full" or px.',
        '- Color is "ink", "muted", "faint", "surface", "info", "success", "warning", "danger", "purple", "pink", "chart1" to "chart6", or a CSS color. As a background, status colors are soft tints.',
      ],
    },
    { name: "Text", components: ["Title", "Text", "Caption", "Label", "Badge", "Link", "List", "ListItem", "Markdown", "Quote", "Code", "Math"] },
    {
      name: "Inputs",
      components: ["Button", "IconButton", "Pressable", "Input", "TextArea", "Select", "SegmentedControl", "Slider", "Checkbox", "RadioGroup", "DatePicker", "Timer", "Form"],
      notes: [
        "- An input's first argument is its value, usually a $variable that other statements read.",
        '- Every input either changes something shown on the page, or sits in a Form whose submit Button sends a short first-person @ToAssistant ("Help me choose a bike"); the form values go with it. No dead inputs.',
      ],
    },
    { name: "Media and data", components: ["SearchImage", "Image", "Icon", "Table", "Chart", "Map", "MapMarker", "YouTube"] },
    { name: "Play", components: ["Flashcard", "Celebration"] },
  { name: "Drawing", components: ["Svg", "G", "Circle", "Ellipse", "Rect", "Line", "Path", "Polyline", "Polygon", "SvgText", "HtmlView"] },
];

/**
 * Primitives the model arranges itself, plus a few widgets for what a model
 * cannot draw (a street map, a sandboxed HTML page). Layout is never fixed here.
 * Generic @functions let a page compute with its own state, so an answer can be
 * a working tool rather than a form sent back to the assistant.
 */
export const library = createLibrary({ root: "Col", components, functions, actions, componentGroups });

/**
 * Edit-mode variant of the same library. It adds only the internal `BlockSlot`
 * wrapper (never offered to the model), so a program rewritten by
 * `wrapProgramForBlockEditing` renders with the normal components and layout.
 */
export const blockEditLibrary = createLibrary({
  root: "Col",
  components: [...components, BlockSlot],
  functions,
  actions,
  componentGroups,
});

/** Containers whose direct children become nested editable blocks (M4-1). */
const NESTED_CONTAINER_NAMES = new Set(["Col", "Row", "Card"]);

/**
 * Edit-mode library variant (M4-1): the same components, but every allowlisted
 * container renderer is wrapped so its direct children render inside a nested
 * `BlockSlot`. Root-level production wrappers from `wrapProgramForBlockEditing`
 * are not re-wrapped. Only `OpenUIRenderer` with `nestedBlockSlots` uses this
 * library; the normal and top-level edit-mode libraries are unchanged.
 */
export const nestedEditLibrary = createLibrary({
  root: "Col",
  components: Object.values(blockEditLibrary.components).map(component =>
    NESTED_CONTAINER_NAMES.has(component.name)
      ? wrapNestedContainer(component as unknown as NestedContainerComponent) as unknown as typeof component
      : component) as never,
  functions,
  actions,
  componentGroups,
});
