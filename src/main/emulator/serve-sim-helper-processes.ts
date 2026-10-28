import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import { commandContainsToken } from '../../shared/command-token-scanner'
import { iterateProcessOutputLines } from '../../shared/process-output-field-scanner'
import { PS_MAX_BUFFER_BYTES } from '../../shared/process-table-snapshot'

export type ServeSimHelperProcess = {
  pid: number
  command: string
}

const SERVE_SIM_DETACHED_HELPER_FLAG = '--exit-on-simulator-shutdown'

type ServeSimHelperProcessLookupOptions = {
  helperPid?: number
  includeOrphaned?: boolean
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5_000, maxBuffer: PS_MAX_BUFFER_BYTES }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout.toString())
    })
  })
}

// Why: serve-sim >= 0.1.47 hosts the helper in node; keep serve-sim-bin so a pre-update helper is still reaped.
function isServeSimHelperCommand(command: string): boolean {
  if (/(^|\/)serve-sim-bin(?:\s|$)/.test(command)) {
    return true
  }
  return (
    commandContainsToken(command, SERVE_SIM_DETACHED_HELPER_FLAG) &&
    /(^|\/)serve-sim(?:\.js)?\s/.test(command)
  )
}

export function parseServeSimHelperProcesses(psOutput: string): ServeSimHelperProcess[] {
  const helpers: ServeSimHelperProcess[] = []
  for (const line of iterateProcessOutputLines(psOutput)) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    const command = match[2] ?? ''
    if (!Number.isInteger(pid) || !isServeSimHelperCommand(command)) {
      continue
    }
    helpers.push({ pid, command })
  }
  return helpers
}

function commandTargetsDevice(command: string, deviceUdid: string): boolean {
  return commandContainsToken(command, deviceUdid)
}

export async function listServeSimHelperProcessesForDevice(
  deviceUdid: string,
  options: ServeSimHelperProcessLookupOptions = {}
): Promise<ServeSimHelperProcess[]> {
  if (platform() !== 'darwin') {
    return []
  }
  const knownPid = options.helperPid
  const includeOrphaned = options.includeOrphaned === true
  if (knownPid === undefined && !includeOrphaned) {
    return []
  }
  // The machine-wide table can exceed the capture ceiling because unrelated argv is unbounded.
  // A session already has its helper PID, so keep the normal attach/readiness path bounded to one row.
  const psArgs =
    knownPid === undefined
      ? ['-axo', 'pid=,command=']
      : ['-p', String(knownPid), '-o', 'pid=,command=']
  const output = await execFileText('ps', psArgs)
  return parseServeSimHelperProcesses(output).filter((helper) => {
    if (knownPid !== undefined) {
      return helper.pid === knownPid && commandTargetsDevice(helper.command, deviceUdid)
    }
    return includeOrphaned && commandTargetsDevice(helper.command, deviceUdid)
  })
}

export async function killServeSimHelperProcessesForDevice(
  deviceUdid: string,
  options: ServeSimHelperProcessLookupOptions = {}
): Promise<void> {
  const helperPids = (await listServeSimHelperProcessesForDevice(deviceUdid, options)).map(
    (helper) => helper.pid
  )

  for (const pid of new Set(helperPids)) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Best effort; serve-sim's own --kill remains the authoritative path.
    }
  }
}
