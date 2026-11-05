/**
 * Containers whose direct children are editable Artifact blocks (M4).
 *
 * Keep this list as the single source of truth for the renderer, the client
 * display tree and the Host validation. Carousel is a special case: its
 * component wraps each child in a carousel item, so nested wrappers need their
 * own CSS compensation; it is included because the component still receives a
 * plain children array.
 */
export const NESTED_CONTAINER_TYPES = [
  'Col',
  'Row',
  'Box',
  'Grid',
  'Card',
  'Section',
  'Carousel',
] as const

export type NestedContainerType = (typeof NESTED_CONTAINER_TYPES)[number]
