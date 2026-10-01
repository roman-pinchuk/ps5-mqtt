import createDebugger from "debug"
import path from "path"
import { Discovery } from "playactor/dist/discovery"
import sh from "shelljs"

import type { Device } from "../redux/types"
import { buildPassCodeArg } from "../util/pass-code"

const debug = createDebugger("@ha:ps5:playactor")

export interface PlayactorClientSettings {
  credentialStoragePath: string
  loginPasscode?: string
  allowPs4Devices?: boolean
}

// Standby requires a full Remote Play handshake (discovery, session init,
// login, passcode, then the standby request itself), which can take much
// longer than a simple wake. The shelljs timeout must safely exceed the sum
// of the discovery/connect timeouts below so a slow but healthy handshake
// isn't killed mid-flight. https://github.com/FunkeyFlo/ps5-mqtt/issues/675
const STANDBY_DISCOVERY_TIMEOUT_MS = 10000
const STANDBY_CONNECT_TIMEOUT_MS = 10000
const STANDBY_SHELLJS_TIMEOUT_MS = 25000

const WAKE_SHELLJS_TIMEOUT_MS = 5000

// Every playactor child gets the shim from ./preload.ts (built next to
// index.js). Appended to NODE_OPTIONS, not replacing it: under Yarn PnP it
// already carries the PnP loader the child needs to resolve `playactor`.
// https://github.com/FunkeyFlo/ps5-mqtt/issues/678
const PLAYACTOR_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_OPTIONS: [
    process.env.NODE_OPTIONS,
    `--require "${path.join(__dirname, "playactor-preload.js")}"`,
  ]
    .filter(Boolean)
    .join(" "),
}

/**
 * A mockable boundary for console operations. Power commands use the CLI;
 * frequent state checks use asynchronous in-process UDP discovery so polling
 * never blocks the server or starts a subprocess.
 */
export interface PlayactorClient {
  wake(ip: string): Promise<void>
  standby(ip: string): Promise<void>
  check(ip: string): Promise<Pick<Device, "status" | "activity">>
}

export function createPlayactorClient({
  credentialStoragePath,
  loginPasscode,
  allowPs4Devices,
}: PlayactorClientSettings): PlayactorClient {
  // Ignore non-PS5 devices during discovery when PS4 devices are excluded,
  // shaving discovery latency off the timeout budget below.
  const devicePs5Arg = allowPs4Devices === false ? " --ps5" : ""

  const buildWakeCommand = (ip: string): string =>
    `playactor wake --ip ${ip}` +
    ` --timeout 5000 --connect-timeout 5000 --no-open-urls --no-auth` +
    buildPassCodeArg(loginPasscode) +
    devicePs5Arg +
    ` -c ${credentialStoragePath}`

  const buildStandbyCommand = (ip: string): string =>
    `playactor standby --ip ${ip}` +
    ` --timeout ${STANDBY_DISCOVERY_TIMEOUT_MS}` +
    ` --connect-timeout ${STANDBY_CONNECT_TIMEOUT_MS} --no-open-urls --no-auth` +
    buildPassCodeArg(loginPasscode) +
    devicePs5Arg +
    ` -c ${credentialStoragePath}`

  // wake/standby share identical exec + error handling; only the sub-command
  // and shelljs timeout differ.
  const runPowerCommand = async (
    command: string,
    shelljsTimeoutMillis: number,
  ): Promise<void> => {
    const { code, stdout, stderr } = sh.exec(command, {
      silent: true,
      timeout: shelljsTimeoutMillis,
      env: PLAYACTOR_ENV,
    })

    if (stderr) {
      throw stderr
    }

    // A shelljs timeout-kill produces no stderr, so `code` is the only
    // remaining signal that the command didn't actually complete - without
    // this check, a standby/wake killed mid-handshake looks identical to a
    // successful one and gets optimistically reported to Home Assistant.
    // https://github.com/FunkeyFlo/ps5-mqtt/issues/675
    if (code !== 0) {
      throw new Error(
        `playactor exited with code ${code} without completing (it may ` +
          "have been killed after exceeding the timeout)",
      )
    }

    debug(stdout)
  }

  return {
    async wake(ip: string): Promise<void> {
      await runPowerCommand(buildWakeCommand(ip), WAKE_SHELLJS_TIMEOUT_MS)
    },

    async standby(ip: string): Promise<void> {
      await runPowerCommand(buildStandbyCommand(ip), STANDBY_SHELLJS_TIMEOUT_MS)
    },

    async check(ip: string): Promise<Pick<Device, "status" | "activity">> {
      const discovery = new Discovery({ deviceIp: ip })
      for await (const device of discovery.discover(
        {},
        { timeoutMillis: 15000 },
      )) {
        return { status: device.status }
      }

      throw new Error(
        "No data received from Playstation. If this error continues, " +
          "your Playstation is likely powered off or unreachable - it will " +
          "not be available until it is in either rest mode/powered on and reachable.",
      )
    },
  }
}
