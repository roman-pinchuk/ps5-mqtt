import lodash from "lodash"
import { Discovery } from "playactor/dist/discovery"
import {
  DeviceStatus,
  DeviceType,
  IDiscoveredDevice,
} from "playactor/dist/discovery/model"
import sh from "shelljs"

import type { Device } from "../../redux/types"
import { createPlayactorClient } from "../client"

jest.mock("shelljs")
jest.mock("playactor/dist/discovery")

const mockExec = jest.mocked(sh.exec)

type ExecReturn = ReturnType<typeof sh.exec>

const CREDENTIAL_PATH = "/tmp/creds.json"
const IP = "192.168.0.10"

const WAKE_CMD =
  `playactor wake --ip ${IP}` +
  ` --timeout 5000 --connect-timeout 5000 --no-open-urls --no-auth` +
  ` -c ${CREDENTIAL_PATH}`

const STANDBY_CMD =
  `playactor standby --ip ${IP}` +
  ` --timeout 10000 --connect-timeout 10000 --no-open-urls --no-auth` +
  ` -c ${CREDENTIAL_PATH}`

// Every playactor invocation must carry the preload shim in NODE_OPTIONS
// (see ../preload.ts); the exact path differs between ts-jest (src/) and the
// built bundle (dist/), so only the file name is pinned here.
const execOptions = (timeout: number) => ({
  silent: true,
  timeout,
  env: expect.objectContaining({
    NODE_OPTIONS: expect.stringContaining("playactor-preload.js"),
  }),
})

describe("PlayactorClient", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const client = createPlayactorClient({
    credentialStoragePath: CREDENTIAL_PATH,
  })

  describe("wake", () => {
    test("builds the correct command and resolves on success", async () => {
      mockExec.mockReturnValue(execResult({ code: 0, stdout: "ok" }))

      await expect(client.wake(IP)).resolves.toBeUndefined()
      expect(mockExec).toHaveBeenCalledWith(WAKE_CMD, execOptions(5000))
    })

    test("includes the --pass-code fragment when a passcode is configured", async () => {
      mockExec.mockReturnValue(execResult({ code: 0, stdout: "ok" }))
      const clientWithPasscode = createPlayactorClient({
        credentialStoragePath: CREDENTIAL_PATH,
        loginPasscode: "1234",
      })

      await clientWithPasscode.wake(IP)

      expect(mockExec).toHaveBeenCalledWith(
        `playactor wake --ip ${IP}` +
          ` --timeout 5000 --connect-timeout 5000 --no-open-urls --no-auth` +
          ` --pass-code '1234'` +
          ` -c ${CREDENTIAL_PATH}`,
        execOptions(5000),
      )
    })

    test("throws the raw stderr when playactor writes to stderr", async () => {
      mockExec.mockReturnValue(execResult({ code: 0, stderr: "boom" }))

      await expect(client.wake(IP)).rejects.toBe("boom")
    })

    test("passes --ps5 when PS4 devices are excluded", async () => {
      mockExec.mockReturnValue(execResult({ code: 0, stdout: "ok" }))
      const ps5OnlyClient = createPlayactorClient({
        credentialStoragePath: CREDENTIAL_PATH,
        allowPs4Devices: false,
      })

      await ps5OnlyClient.wake(IP)

      expect(mockExec).toHaveBeenCalledWith(
        `playactor wake --ip ${IP}` +
          ` --timeout 5000 --connect-timeout 5000 --no-open-urls --no-auth` +
          ` --ps5 -c ${CREDENTIAL_PATH}`,
        execOptions(5000),
      )
    })

    // https://github.com/FunkeyFlo/ps5-mqtt/issues/675
    test("rejects when killed by the shelljs timeout (no stderr, non-zero exit code)", async () => {
      mockExec.mockReturnValue(execResult({ code: 1, stdout: "", stderr: "" }))

      await expect(client.wake(IP)).rejects.toThrow(/exited with code 1/)
    })
  })

  describe("standby", () => {
    test("builds the correct command and resolves on success", async () => {
      mockExec.mockReturnValue(execResult({ code: 0, stdout: "ok" }))

      await expect(client.standby(IP)).resolves.toBeUndefined()
      expect(mockExec).toHaveBeenCalledWith(STANDBY_CMD, execOptions(25000))
    })

    test("throws the raw stderr when playactor writes to stderr", async () => {
      mockExec.mockReturnValue(execResult({ code: 0, stderr: "nope" }))

      await expect(client.standby(IP)).rejects.toBe("nope")
    })

    test("passes --ps5 when PS4 devices are excluded", async () => {
      mockExec.mockReturnValue(execResult({ code: 0, stdout: "ok" }))
      const ps5OnlyClient = createPlayactorClient({
        credentialStoragePath: CREDENTIAL_PATH,
        allowPs4Devices: false,
      })

      await ps5OnlyClient.standby(IP)

      expect(mockExec).toHaveBeenCalledWith(
        `playactor standby --ip ${IP}` +
          ` --timeout 10000 --connect-timeout 10000 --no-open-urls --no-auth` +
          ` --ps5 -c ${CREDENTIAL_PATH}`,
        execOptions(25000),
      )
    })

    // https://github.com/FunkeyFlo/ps5-mqtt/issues/675
    // Standby's full handshake (discovery, session init, login, passcode,
    // then the standby request) can outlast a short shelljs timeout. When
    // shelljs kills the process, it exits with code 1 and empty
    // stdout/stderr - nothing throws, so the old stderr-only check never
    // fired and the saga optimistically reported STANDBY even though the
    // console never actually went to standby. Verified this is really how
    // shelljs behaves on a timeout-kill (sh.exec("sleep N", { timeout:
    // shortMs }) consistently returns { code: 1, stdout: "", stderr: "" });
    // it could not be reproduced against real PS5 hardware.
    test("rejects when killed by the shelljs timeout (no stderr, non-zero exit code)", async () => {
      mockExec.mockReturnValue(execResult({ code: 1, stdout: "", stderr: "" }))

      await expect(client.standby(IP)).rejects.toThrow(/exited with code 1/)
    })
  })

  describe("check", () => {
    test("uses discovery without spawning a process and closes the iterator on success", async () => {
      const closed = jest.fn()
      async function* responses() {
        try {
          yield discoveredDevice()
        } finally {
          closed()
        }
      }
      const discover = mockDiscovery(responses())

      await expect(client.check(IP)).resolves.toEqual({ status: "AWAKE" })
      expect(Discovery).toHaveBeenCalledWith({ deviceIp: IP })
      expect(discover).toHaveBeenCalledWith({}, { timeoutMillis: 15000 })
      expect(mockExec).not.toHaveBeenCalled()
      expect(closed).toHaveBeenCalledTimes(1)
    })

    test("waits asynchronously for a delayed response", async () => {
      let respond!: (device: IDiscoveredDevice) => void
      const response = new Promise<IDiscoveredDevice>((resolve) => {
        respond = resolve
      })
      async function* responses() {
        yield await response
      }
      mockDiscovery(responses())
      const check = client.check(IP)
      await new Promise<void>((resolve) => setImmediate(resolve))
      respond(discoveredDevice())
      await expect(check).resolves.toMatchObject({ status: "AWAKE" })
      expect(mockExec).not.toHaveBeenCalled()
    })

    test("rejects when discovery times out without a response", async () => {
      async function* responses() {}
      mockDiscovery(responses())
      await expect(client.check(IP)).rejects.toThrow(
        "No data received from Playstation",
      )
    })
  })
})

// --- helpers ---

const DEFAULT_DEVICE: Device = {
  address: { address: IP, port: 80 },
  available: true,
  id: "mock-id-1",
  name: "mock-ps5-1",
  normalizedName: "mock_ps5_1",
  status: "AWAKE",
  systemVersion: "",
  transitioning: false,
  type: "PS5",
  activity: undefined,
}

function makeDevice(overrides: Partial<Device> = {}): Device {
  return lodash.merge({}, DEFAULT_DEVICE, overrides)
}

function discoveredDevice(): IDiscoveredDevice {
  return {
    ...makeDevice(),
    address: { address: IP, port: 9302, family: "IPv4" },
    status: DeviceStatus.AWAKE,
    type: DeviceType.PS5,
    hostRequestPort: 997,
    extras: {},
    discoveryVersion: "00030010",
  }
}

function mockDiscovery(responses: AsyncGenerator<IDiscoveredDevice>) {
  const discover = jest.fn().mockReturnValue(responses)
  jest
    .mocked(Discovery)
    .mockImplementation(() => ({ discover }) as unknown as Discovery)
  return discover
}

function execResult(
  over: Partial<{ code: number; stdout: string; stderr: string }> = {},
): ExecReturn {
  return { code: 0, stdout: "", stderr: "", ...over } as unknown as ExecReturn
}
