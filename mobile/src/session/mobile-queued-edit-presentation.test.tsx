import { mobileQueuedEditHarness } from './mobile-queued-edit-hook.test-fixture'
import { createElement, type ReactNode } from 'react'
import { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ScrollView, TextInput } from 'react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { MobileQueuedMessageComposerContext } from './mobile-queued-message-composer-context'
import { MobileNativeChatQueuedMessages } from './native-chat/input/MobileNativeChatQueuedMessages'
import {
  MobileNativeChatComposer,
  MobileNativeChatDraftComposer
} from './native-chat/composer/MobileNativeChatComposer'
import { MobileNativeChatComposerMenu } from './native-chat/composer/MobileNativeChatComposerMenu'
import { MobileQueuedMessageComposer } from './MobileQueuedMessageComposer'
import { setMobileNativeChatDraftText } from './native-chat/composer/mobile-native-chat-draft-store'
import { readMobileNativeChatDraftInputs } from './native-chat/composer/mobile-native-chat-draft-inputs'
import { queuedDraft, SESSION_ID } from './use-mobile-structured-agent-session-queued.test-fixture'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({}) }))
vi.mock('../components/DragReorderList', () => ({ DragReorderList: 'DragReorderList' }))
vi.mock('react-native-reanimated', async () => {
  const { useRef } = await import('react')
  return {
    default: { ScrollView: 'ScrollView' },
    useAnimatedRef: () => useRef(null),
    useSharedValue: (value: unknown) => useRef({ value }).current
  }
})
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: 'ActionSheetModal' }))
vi.mock('../components/mounted-bottom-drawer', () => ({ MountedBottomDrawer: 'BottomDrawer' }))
vi.mock('../components/bottom-drawer-modal-host-scope', () => ({
  useBottomDrawerModalHost: () => null
}))

describe('phone inline editor presentation', () => {
  const { state, Harness, mount, sendRequest, error, resolved } = mobileQueuedEditHarness()
  async function rows(
    message: Parameters<typeof mount>[0],
    agent = 'codex',
    sessionId = SESSION_ID,
    catalog: { reported: { name: string; kind: 'skill' | 'command'; path?: string }[] } = {
      reported: []
    },
    extra?: (hook: NonNullable<typeof state.hook>) => ReactNode
  ) {
    await mount(message, true, agent, sessionId)
    act(() => state.hook!.queued.editor!.cancel())
    resolved.mockClear()
    const renderContent: NonNullable<Parameters<typeof Harness>[0]['renderContent']> = (hook) =>
      createElement(
        MobileQueuedMessageComposerContext.Provider,
        {
          value: {
            agent,
            structured: {
              catalog: { reported: catalog.reported, conversationCommands: [] },
              onSlashMenuOpen: () => {},
              files: [],
              onRemoveFile: () => {}
            },
            filePaths: [],
            onNeedFiles: undefined,
            onError: error,
            onMicPress: undefined,
            micActive: false,
            dictationMode: undefined,
            onMicPressIn: () => {},
            onMicPressOut: () => {}
          }
        },
        createElement(MobileNativeChatQueuedMessages, {
          cards: hook.queued.cards,
          onEdit: hook.queued.edit,
          editor: hook.queued.editor
        }),
        extra?.(hook)
      )
    const rerender = async () =>
      act(async () =>
        state.renderer!.update(
          createElement(Harness, {
            sessionId,
            agent,
            renderContent,
            skillsSupport: true,
            imagesSupport: true,
            composerScopeKey: 'original-bottom'
          })
        )
      )
    await rerender()
    const root = () => state.renderer!.root
    const button = (label: string) =>
      root().findAll(
        (node) =>
          node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
      )[0]!
    const field = () =>
      root().find((node) => node.type === TextInput && node.props.multiline === true)
    const open = async () => {
      await act(async () => button('More actions').props.onPress())
      const sheet = root().find(
        (node) =>
          node.type === ActionSheetModal && node.props.actions?.[0]?.label === 'Edit message'
      )
      await act(async () => sheet.props.actions[0].onPress())
      expect(root().findAllByType(MobileQueuedMessageComposer)).toHaveLength(1)
      expect(root().findAllByType(MobileNativeChatComposer)).toHaveLength(extra ? 2 : 1)
    }
    await open()
    return { root, button, field, rerender, open }
  }
  it('gives the short image editor and open picker the available queue scroll space, separate from the ordinary draft', async () => {
    const message = queuedDraft({
      messageId: 'photo-layout',
      body: {
        kind: 'message',
        role: 'user',
        blocks: [
          { type: 'text', text: 'short edit' },
          { type: 'image-ref', url: 'https://host/photo.png', alt: 'photo' }
        ]
      }
    })
    const catalog = {
      reported: Array.from({ length: 6 }, (_, i) => ({
        name: `skill-${i}`,
        kind: 'skill' as const,
        path: `/skills/${i}/SKILL.md`
      }))
    }
    const { root, button } = await rows(message, 'codex', SESSION_ID, catalog, () =>
      createElement(MobileNativeChatDraftComposer, {
        draftKey: 'original-bottom',
        draftScopeKey: 'original-bottom',
        agent: 'codex',
        structured: {
          catalog: { ...catalog, conversationCommands: [] },
          onSlashMenuOpen: () => {},
          files: [],
          onRemoveFile: () => {}
        },
        onChangeText: (text) => setMobileNativeChatDraftText('original-bottom', text),
        onSend: async () => true,
        sendSurfaceId: 'original-bottom',
        getSendCompletionGeneration: () => 0,
        getComposerEditGeneration: () => 0
      })
    )
    const { snapshotEvent } =
      await import('./use-mobile-structured-agent-session-queued.test-fixture')
    act(() => {
      setMobileNativeChatDraftText('original-bottom', 'Bottom draft stays here.')
      state.listener?.(
        snapshotEvent({
          queuedMessages: [message, queuedDraft({ messageId: 'neighbor', position: 2 })],
          runningTurn: true
        })
      )
    })
    const style = (value: unknown): Record<string, unknown> => Object.assign({}, ...[value].flat())
    const queue = () => root().findByType(MobileNativeChatQueuedMessages)
    const scroll = () =>
      queue().find((node) => node.type === ScrollView && node.props.onContentSizeChange)
    const box = () => root().findByProps({ testID: 'queued-box' })
    const editor = () => root().findByType(MobileQueuedMessageComposer)
    const bottom = () => root().findByType(MobileNativeChatDraftComposer)
    expect(editor().findByType(MobileNativeChatComposer).props.attachments).toHaveLength(1)
    expect(queue().findAllByProps({ testID: 'queued-card-row' })).toHaveLength(2)
    // Every boundary down to the scrollport must yield to the keyboard/bottom siblings.
    for (const node of [box().parent!, box(), scroll().parent!, scroll()]) {
      expect(style(node.props.style)).toMatchObject({ flexShrink: 1, minHeight: 0 })
    }
    expect(style(scroll().props.style).maxHeight).toBeUndefined()
    expect(style(box().parent!.props.style).marginBottom).toBe(0)
    expect(style(box().props.style).paddingBottom).toBe(0)
    expect(queue().findAllByType(MobileNativeChatDraftComposer)).toHaveLength(0)
    const field = editor().findByType(TextInput)
    act(() => {
      field.props.onChangeText('/')
      field.props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } })
    })
    const menuScroll = root().findByType(MobileNativeChatComposerMenu).findByType(ScrollView)
    expect(style(menuScroll.props.style).maxHeight).toBe(300)
    expect(menuScroll.props.nestedScrollEnabled).toBe(true)
    expect(menuScroll.props.keyboardShouldPersistTaps).toBe('always')
    const scrollTo = vi.fn()
    scroll().props.ref.current = { scrollTo, flashScrollIndicators: vi.fn() }
    act(() => {
      scroll().props.onLayout({ nativeEvent: { layout: { height: 280 } } })
      scroll().props.onContentSizeChange(360, 800)
      editor().parent!.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 620 } }
      })
    })
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 0, animated: false })
    act(() => scroll().props.onScroll({ nativeEvent: { contentOffset: { y: 120 } } }))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    await act(async () => button('$skill-5').props.onPress())
    expect(state.hook!.queued.editor?.text).toBe('$skill-5 ')
    expect(readMobileNativeChatDraftInputs(state.hook!.queued.editor!.scopeKey).skills).toEqual([
      { name: 'skill-5', path: '/skills/5/SKILL.md' }
    ])
    expect(editor().findByType(MobileNativeChatComposer).props.attachments).toHaveLength(1)
    expect(bottom().findByType(TextInput).props.value).toBe('Bottom draft stays here.')
    await act(async () => button('Cancel editing').props.onPress())
    expect(style(scroll().props.style).maxHeight).toBe(160)
    expect(style(box().parent!.props.style).marginBottom).toBeLessThan(0)
    expect(bottom().findByType(TextInput).props.value).toBe('Bottom draft stays here.')
    act(() => {
      bottom().findByType(TextInput).props.onChangeText('/')
      bottom()
        .findByType(TextInput)
        .props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } })
    })
    const ordinaryMenu = bottom().findByType(MobileNativeChatComposerMenu).findByType(ScrollView)
    expect(style(ordinaryMenu.props.style).maxHeight).toBe(300)
    expect(ordinaryMenu.props.nestedScrollEnabled).toBeFalsy()
    expect(
      sendRequest.mock.calls.some(([method]) => method === 'agentSession.queuedMessageUpdate')
    ).toBe(false)
  })
  it('retiring a selected namesake refuses typed and stale command activation through the real wrapper', async () => {
    const message = queuedDraft({ messageId: 'namesake' })
    const { root, button, field } = await rows(message, 'claude', SESSION_ID, {
      reported: [{ name: 'model', kind: 'skill', path: '/A/SKILL.md' }]
    })
    act(() => field().props.onChangeText('/'))
    act(() => field().props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } }))
    const stale = root().findByType(MobileNativeChatComposerMenu).props.onPick
    await act(async () => button('/model').props.onPress())
    const key = state.hook!.queued.editor!.scopeKey
    expect(readMobileNativeChatDraftInputs(key).skills).toHaveLength(1)
    act(() => stale({ kind: 'command', token: '/model', name: 'model', id: 'command:model' }))
    expect(error).toHaveBeenLastCalledWith("Commands can't be saved in a queued message.")
    expect(state.hook!.queued.editor!.text).toBe('/model ')
    act(() => field().props.onChangeText(''))
    act(() => field().props.onChangeText('/model'))
    expect(readMobileNativeChatDraftInputs(key).skills).toEqual([])
    await act(async () => button('Save edited message').props.onPress())
    expect(error).toHaveBeenCalledTimes(2)
    expect(
      sendRequest.mock.calls.some(([method]) =>
        /(?:Update|send|conversationCommand|pty)/.test(method)
      )
    ).toBe(false)
    expect(state.hook!.queued.editor).toBeDefined()
  })

  it('an image-only attributed card reaches the actual inline composer and no-op Save retains its image and sender', async () => {
    const message = queuedDraft({
      messageId: 'photo-only',
      body: {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'image-ref', url: 'https://host/photo.png', alt: 'photo' }],
        from: { kind: 'agent', senders: [], orchestration: null }
      }
    })
    const { root, button } = await rows(message)
    expect(root().findByType(MobileNativeChatComposer).props.attachments).toHaveLength(1)
    await act(async () => button('Save edited message').props.onPress())
    expect(state.hook!.queued.editor).toBeUndefined()
    expect(
      sendRequest.mock.calls.some(([method]) => method === 'agentSession.queuedMessageUpdate')
    ).toBe(false)
    expect(state.hook!.queued.cards[0]?.images).toEqual(message.body.blocks)
    expect(state.hook!.queued.cards[0]?.attribution).not.toBeNull()
    expect(state.bottomText).toBe('')
  })
})
