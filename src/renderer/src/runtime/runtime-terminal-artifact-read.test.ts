import { describe, expect, it } from 'vitest'
import { readRuntimeFileContent, readRuntimeFilePreview } from './runtime-file-read-client'
import {
  runtimeEnvironmentCall,
  runtimeEnvironmentTransportCall,
  fsReadFile,
  installRuntimeFileClientEnvironment
} from './runtime-file-client-test-harness'
import { createCompatibleRuntimeStatusResponseIfNeeded } from './runtime-compatibility-test-fixture'

installRuntimeFileClientEnvironment()

const granted = {
  target: { kind: 'environment' as const, environmentId: 'env-1' },
  filePath: '/tmp/out.png',
  relativePath: '/tmp/out.png',
  worktreeId: 'wt-1',
  terminalArtifactGrantId: 'g-1'
}
const grantParams = { worktree: 'id:wt-1', grantId: 'g-1', absolutePath: '/tmp/out.png' }

function grantIdOf(params: unknown): string | undefined {
  return typeof params === 'object' && params !== null && 'grantId' in params
    ? String(params.grantId)
    : undefined
}

describe('a granted host file outside every workspace', () => {
  it.each(['tab', 'chat image'])('previews a %s through its host grant', async (consumer) => {
    const preview = { content: 'iVBO', isBinary: true, isImage: true, mimeType: 'image/png' }
    runtimeEnvironmentCall.mockImplementation((args: { method: string }) =>
      Promise.resolve(
        args.method === 'files.resolveTerminalPath'
          ? {
              id: 'resolve',
              ok: true,
              result: {
                exists: true,
                openTarget: {
                  kind: 'absolute-file',
                  absolutePath: granted.filePath,
                  grantId: 'g-1'
                }
              },
              _meta: { runtimeId: 'remote-runtime' }
            }
          : args.method === 'files.readTerminalArtifact'
            ? {
                id: 'rpc-1',
                ok: false,
                error: { code: 'runtime_error', message: 'binary_file' },
                _meta: { runtimeId: 'remote-runtime' }
              }
            : { id: 'rpc-2', ok: true, result: preview, _meta: { runtimeId: 'remote-runtime' } }
      )
    )

    await expect(
      consumer === 'tab'
        ? readRuntimeFileContent(granted)
        : readRuntimeFilePreview(
            { target: granted.target, worktreeId: granted.worktreeId, worktreePath: '/repo' },
            granted.filePath,
            { kind: 'chat-image' }
          )
    ).resolves.toEqual(preview)
    expect(fsReadFile).not.toHaveBeenCalled()
    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'files.readTerminalArtifactPreview', params: grantParams })
    )
    expect(runtimeEnvironmentCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'files.read' })
    )
  })

  it.each(['missing', 'unreachable'])(
    'keeps a %s chat image on its host even when this computer has the same path',
    async (failure) => {
      fsReadFile.mockResolvedValue({ content: 'client image', isBinary: true })
      if (failure === 'missing') {
        runtimeEnvironmentTransportCall.mockImplementation(
          (args) =>
            createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
        )
        runtimeEnvironmentCall.mockResolvedValue({
          id: 'resolve',
          ok: true,
          result: { exists: false, relativePath: null },
          _meta: { runtimeId: 'remote-runtime' }
        })
      } else {
        runtimeEnvironmentCall.mockRejectedValue(new Error('host refused'))
      }
      await expect(
        readRuntimeFilePreview(
          { target: granted.target, worktreeId: granted.worktreeId, worktreePath: '/repo' },
          granted.filePath,
          { kind: 'chat-image' }
        )
      ).rejects.toThrow(
        failure === 'missing' ? `File not found on its host: ${granted.filePath}` : 'host refused'
      )
      expect(fsReadFile).not.toHaveBeenCalled()
    }
  )

  // Why: Reload, Compare and Keep My Edits read a file whose host change staled the tab's grant.
  it('renews a stale grant for the same path and reads through the new one', async () => {
    const grantedText = { ...granted, filePath: '/tmp/out.txt', relativePath: '/tmp/out.txt' }
    const meta = { runtimeId: 'remote-runtime' }
    runtimeEnvironmentCall.mockImplementation(
      async (args: { method: string; params?: unknown }) => {
        if (args.method === 'files.resolveTerminalPath') {
          return {
            id: 'rpc',
            ok: true,
            result: {
              worktree: 'wt-1',
              relativePath: null,
              absolutePath: '/tmp/out.txt',
              exists: true,
              isDirectory: false,
              openTarget: {
                kind: 'absolute-file',
                provider: 'local',
                absolutePath: '/tmp/out.txt',
                grantId: 'g-2'
              }
            },
            _meta: meta
          }
        }
        return grantIdOf(args.params) === 'g-1'
          ? {
              id: 'rpc',
              ok: false,
              error: { code: 'runtime_error', message: 'terminal_file_grant_stale' },
              _meta: meta
            }
          : {
              id: 'rpc',
              ok: true,
              result: {
                worktree: 'wt-1',
                relativePath: '/tmp/out.txt',
                content: 'new',
                truncated: false,
                byteLength: 3
              },
              _meta: meta
            }
      }
    )

    await expect(readRuntimeFileContent(grantedText)).resolves.toEqual({
      content: 'new',
      isBinary: false
    })
    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'files.readTerminalArtifact',
        params: { ...grantParams, absolutePath: grantedText.filePath, grantId: 'g-2' }
      })
    )
  })
})
