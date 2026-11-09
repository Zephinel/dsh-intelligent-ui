/**
 * Browser half of the Intelligent UI extension.
 *
 * A completed Turn that called the host tool `render_ui` gets one interactive
 * card at its end (the Chat's turn-tail list), and the call's own Tool row
 * becomes a compact process line instead of exposing the raw program. The
 * composer's `conversation.input.activity` seat carries the per-session on/off
 * switch that gates the tool and its prompt, and the Plugin detail page carries
 * the deployment-wide free-composition preference.
 *
 * Only `import type` reaches other DSH feature packages; runtime imports are
 * this repo's own modules, React, and the shell's platform modules (the icon
 * and disclosure primitives).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pull the ui-chat `conversation.chat.turnTail` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pull the ui-conversation SlotMap / input contract merges.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pull the `remote.commands` client service merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pull the ui-session standard props (`sessions` service, session scope).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pull the ui-tool `tool.call.toolview` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: pull the client locale service (`ctx.locale`) and its dictionary types.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pull the settings `configForms` service merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pull the Plugins page `plugins.bundle.config` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { InputOrbit } from './InputOrbit.tsx'
import { IntelligentUICards, type IntelligentUICardsInjected } from './IntelligentUICards.tsx'
import { ExportAction, type ExportActionInjected } from './ExportAction.tsx'
import { RenderUiRow } from './RenderUiRow.tsx'
import { SettingsPage, type SettingsFormLike, type SettingsPageInjected } from './SettingsPage.tsx'
import { DraftDock, type DraftDockInjected } from './artifact-edit/DraftDock.tsx'
import { ToggleControl, type ToggleControlInjected } from './ToggleControl.tsx'
import { enableCommand, onDemandCommand, startModeSync, styleCommand } from './commands.ts'
import { clientToken } from './client-token.ts'
import { OnDemandHint, type OnDemandHintInjected } from './OnDemandHint.tsx'
import type { ComposerAccess } from './composer.ts'
import { styleCatalog } from './styles.ts'
import { styleActions } from './style-actions.ts'
import { programsForMessage, type ExportChatSnapshot } from './export-data.ts'
import { createWorkspaceImageResolver, type WorkspaceImageRemote } from './image-source.ts'
import type { ImageSourceResolver } from '../shared/image-source.ts'
import { revisionFallbackMap, revisionFallbacksFor } from './artifact-edit/revision-fallbacks.ts'
import { registerArtifactEditChip } from './artifact-edit/composer.ts'
import { ArtifactEditSummary, artifactEditSummaryRule } from './artifact-edit/user-text.tsx'
import { ARTIFACT_EDIT_SUMMARY, BLOCK_EDIT_TOOL } from '../shared/artifact-edit.ts'
import {
  HOST_ENTRY_ID,
  PACKAGE_NAME,
  readImageExportSettings,
  resultIdOf,
  type SessionEnable,
  type StylePreference,
} from '../shared/intelligent-ui.ts'
import { NS, en, zh, fallbackT } from '../shared/locales.ts'
import './index.css'

/** Client plugin name shown by the shell. */
export const name = 'intelligent-ui'

/** Services this plugin reads: locale, slots, Session bindings, and command RPC. */
export const inject = ['locale', 'sessions', 'slots', 'uiConversation', 'conversation', 'remote', 'remote.commands']

/** Stable list id for the Turn-tail contribution. */
const CARD_ID = 'intelligent-ui'

/** Stable list id for the per-message export entry. */
const EXPORT_ID = 'intelligent-ui-export'

/** Host settings form captured for the export entry; absent on minimal deployments. */
let settingsForm: SettingsFormLike | undefined

/**
 * Workspace file Remote registered by the DSH web shell; absent on deployments
 * without the workspace-files service, where local image paths degrade to the
 * renderer's "unsupported Host" placeholder.
 */
let workspaceImageRemote: WorkspaceImageRemote | undefined
/** One stable resolver per Session, so card renders do not rebind image effects. */
const imageResolvers = new Map<string, ImageSourceResolver>()

/**
 * Register the Turn-tail cards, the compact `render_ui` Tool row, the composer
 * Intelligent UI switch, the per-message export entry, and the extension's
 * Settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const token = clientToken()
  // Optional: local image sources need the workspace-files client namespace.
  // Deferred injection keeps the plugin loading on Hosts without that service.
  ctx.inject?.(['remote.workspaceFiles'], (scope: unknown) => {
    const scoped = scope as {
      readonly remote?: { readonly workspaceFiles?: WorkspaceImageRemote }
      effect?(fn: () => unknown): unknown
    }
    workspaceImageRemote = scoped.remote?.workspaceFiles
    scoped.effect?.(() => () => { workspaceImageRemote = undefined })
  })
  /** Resolver for local image paths in one Session's cards (stable identity). */
  const resolveImageFor = (sessionId: SessionId): ImageSourceResolver => {
    const key = String(sessionId)
    const cached = imageResolvers.get(key)
    if (cached !== undefined) return cached
    const resolver: ImageSourceResolver = (path: string) => {
      const remote = workspaceImageRemote
      if (remote === undefined) return Promise.resolve({ ok: false, problem: 'unsupported-host' as const })
      return createWorkspaceImageResolver(key, { remote })(path)
    }
    imageResolvers.set(key, resolver)
    return resolver
  }
  const run = async (sessionId: SessionId, command: string): Promise<string | null> => {
    const result = await ctx.remote.commands.execute(sessionId, command, [])
    if (!result.ok) return `${result.error.message} (${result.error.code})`
    if (result.value === undefined) return `unknown command: ${command}`
    const execution = result.value as { result?: { kind?: string; text?: string } }
    if (execution.result?.kind === 'error') return execution.result.text ?? 'Command failed'
    return null
  }
  const composerFor = (sessionId: SessionId): ComposerAccess => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`intelligent-ui: unknown session "${sessionId}"`)
    const input = () => ctx.conversation.input.for(binding.ctx)
    return {
      readInput: () => input().state.getSnapshot(),
      focusComposer: () => { input().focus() },
    }
  }
  // One channel per page keeps the chip/style panel consistent across tabs.
  startModeSync()
  // Both dictionaries go in one registration so every slot below can translate
  // through the `t` seat. A later locale switch re-renders the mounted outlets.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'intelligent-ui: dictionaries')
  // One document-level layer gives every plugin input the same orbit focus cue.
  ctx.effect(() => {
    const host = document.createElement('div')
    host.className = 'dsh-iui-input-orbit-host'
    document.body.append(host)
    const root = createRoot(host)
    root.render(createElement(InputOrbit))
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'intelligent-ui: input orbit')
  // Artifact block editing: the edit request is one composer reference chip, so
  // an ordinary Send serializes it into the structured model-facing envelope.
  // The same envelope collapses back into one chip in the sent message.
  const localeSeat = (): typeof fallbackT => typeof ctx.locale.bind === 'function'
    ? ctx.locale.bind(NS) as typeof fallbackT
    : fallbackT
  registerArtifactEditChip(ctx, {
    readInput: sessionId => composerFor(sessionId).readInput(),
    inputFor: sessionId => {
      const binding = ctx.sessions.binding(sessionId)
      return binding === undefined ? undefined : ctx.conversation.input.for(binding.ctx) as never
    },
  }, localeSeat)
  // The sent-message chip needs the user-text registry; a minimal host without
  // it keeps the envelope as text, which is degraded but never broken.
  const userText = (ctx.uiConversation as { userText?: { register(rule: unknown): () => void } }).userText
  if (typeof userText?.register === 'function') {
    ctx.effect(() => userText.register(artifactEditSummaryRule), 'intelligent-ui: artifact edit summary rule')
    ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
      name: 'conversation.user.text.node',
      key: ARTIFACT_EDIT_SUMMARY,
      locale: NS,
    }, ArtifactEditSummary))
  }
  /** Resolve the Chat target for one Session binding, or fail loudly. */
  const chatFor = (sessionId: SessionId) => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`intelligent-ui: unknown session "${sessionId}"`)
    return ctx.uiConversation.binding(binding).target('chat')
  }
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: CARD_ID,
    locale: NS,
    inject: (sessionId: SessionId): IntelligentUICardsInjected => {
      const chat = chatFor(sessionId)
      return {
        sessionId,
        styles: styleCatalog,
        styleActions,
        resolveImage: resolveImageFor(sessionId),
        ...composerFor(sessionId),
        // The footer adjust addresses the Host result snapshot, which lives under
        // the recorded revision id after a rollback (callId stays the first one).
        adjustStyle: program => run(sessionId, onDemandCommand('adjust', token, resultIdOf(program))),
        keyedHooks: {
          programs: (turn: string) => {
            const snapshot = chat.getSnapshot()
            if (snapshot === undefined) throw new Error('intelligent-ui: Chat target is unavailable')
            return snapshot.nodes.turnDataSource(Number(turn), 'tool-call')
          },
        },
      }
    },
  }, IntelligentUICards))
  // Per-message export entry in the standard action strip. The owner gives us
  // only the durable message id; the injected face resolves it to the Turn's
  // recorded render_ui programs and reads the image-export preferences.
  // Answers without a recorded program stay out of the row.
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: EXPORT_ID,
    order: 20,
    locale: NS,
    inject: (sessionId: SessionId): ExportActionInjected => {
      const chat = chatFor(sessionId)
      return {
        programsFor: (messageId: string) => {
          const snapshot = chat.getSnapshot()
          if (snapshot === undefined) return []
          // A card that rolled back after its revision was deleted exports the
          // fallback revision too, so the export matches the visible card.
          const fallbacks = revisionFallbackMap(revisionFallbacksFor(String(sessionId)))
          return programsForMessage(snapshot as unknown as ExportChatSnapshot, messageId, fallbacks)
        },
        styles: styleCatalog,
        sessionId,
        settings: () => readImageExportSettings(settingsForm?.getSnapshot().value),
      }
    },
  }, ExportAction))
  // Replace the generic Tool row for this wire name: the program belongs in the
  // closing Turn's card, not in the collapsible process list.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'render_ui', locale: NS },
    RenderUiRow,
  ))
  // Composer controls: one explicit scope/style command per action; the host
  // projection `intelligent-ui` owns the settled state and the pending fold.
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity',
    locale: NS,
    inject: (sessionId: SessionId): ToggleControlInjected => {
      return {
        sessionId,
        styles: styleCatalog,
        styleActions,
        focusComposer: composerFor(sessionId).focusComposer,
        armOnDemand: clientInstanceId => run(sessionId, onDemandCommand('arm', clientInstanceId)),
        flip: (scope: SessionEnable): Promise<string | null> => run(sessionId, enableCommand(scope)),
        setStyle: (style: StylePreference): Promise<string | null> => run(sessionId, styleCommand(style)),
      }
    },
  }, ToggleControl))
  // Session-wide pending-edit drafts live at the top of the composer card; the
  // right-side edit panel is per artifact and no longer carries the chat-wide
  // switcher.
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'intelligent-ui-drafts',
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): DraftDockInjected => ({ sessionId }),
  }, DraftDock))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'intelligent-ui-on-demand',
    locale: NS,
    inject: (sessionId: SessionId): OnDemandHintInjected => ({
      clientInstanceId: token,
      ...composerFor(sessionId),
      armOnDemand: (clientInstanceId, options) => run(sessionId, options?.kind === 'adjust' && options.parentResultId !== undefined
        ? onDemandCommand('adjust', clientInstanceId, options.parentResultId)
        : onDemandCommand('arm', clientInstanceId)),
      cancelOnDemand: () => run(sessionId, onDemandCommand('cancel')),
    }),
  }, OnDemandHint))
  // Configuration on this bundle's Plugins detail page: global enablement, answer
  // style, free composition and the image-export defaults persisted as volatile
  // Host settings fields. Optional: a deployment without the settings domain
  // keeps the composer control, the card and the export entry (with defaults).
  ctx.inject(['configForms'], (child) => {
    const form = child.configForms.get(HOST_ENTRY_ID) as unknown as SettingsFormLike
    settingsForm = form
    child.slots.inject('plugins.bundle.config', () => child.slots.register({
      name: 'plugins.bundle.config',
      key: PACKAGE_NAME,
      locale: NS,
      inject: (): SettingsPageInjected => ({ settingsForm: form, styles: styleCatalog, styleActions }),
    }, SettingsPage))
  })
}
