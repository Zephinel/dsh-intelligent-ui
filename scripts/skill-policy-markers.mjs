/**
 * Single source for the shipped Agent Skill's policy-wording contract.
 *
 * The packaging guardrail (`test/packaging/guardrails.test.mjs`) and the package
 * release check (`scripts/release-check.mjs`) both assert the same thing: the
 * skill in the checkout, in the tarball and in an installed profile must carry
 * the current page-vs-text policy and must not carry retired wording. Keeping
 * the markers here means one wording change updates every assertion instead of
 * leaving three copies to drift.
 */

/** Wording the shipped skill must contain. */
export const CURRENT_SKILL_MARKERS = [
  'the model decides the format per answer',
  'loads this skill only when it renders',
  'applies it rather than restating it',
  'Draw the mechanism',
  '## Document mode (experimental)',
]

/** Wording that means a stale skill (or a restated policy) is being shipped. */
export const RETIRED_SKILL_MARKERS = [
  'a page is the default answer format',
  'prose is the bounded exception',
  'Answer in Markdown only when the whole answer is',
  'a definition or concise explanation',
  'Render a page when the answer gains from structure',
  'when the answer gains from structure',
  'would only decorate a short answer',
  'A knowledge or explainer topic is not automatically a prose answer',
  'adds the decision boundary',
]
