import { ServerHandle, startServer } from "./support/server-harness"
import { startUdpConsole } from "./support/udp-console"

describe("check devices state polling (e2e)", () => {
  let server: ServerHandle
  let console: Awaited<ReturnType<typeof startUdpConsole>>

  beforeAll(async () => {
    // Fast polling so the scenario doesn't need a long test timeout.
    const deviceId = "udp-polling-test"
    console = await startUdpConsole(deviceId)
    server = await startServer({
      deviceId,
      deviceStatus: "STANDBY",
      deviceCheckInterval: 300,
    })
  })

  afterAll(async () => {
    await server?.stop()
    await console?.stop()
  })

  test("picks up a status change without a set/power command", async () => {
    console.setStatus("AWAKE")

    const state = await server.mqtt.waitForMessage(
      `ps5-mqtt/${server.deviceId}`,
      (payload) => typeof payload === "object" && payload.power === "AWAKE",
      15000,
    )

    expect(state).toMatchObject({ power: "AWAKE", device_status: "online" })
  })

  test("marks the console unavailable once checks start failing", async () => {
    console.setResponding(false)

    const state = await server.mqtt.waitForMessage(
      `ps5-mqtt/${server.deviceId}`,
      (payload) =>
        typeof payload === "object" && payload.device_status === "offline",
      20000,
    )

    expect(state).toMatchObject({ power: "UNKNOWN", device_status: "offline" })
  }, 25000)

  test("recovers after dropped packets with checks longer than the polling interval", async () => {
    const requestsBefore = console.requests
    console.dropNextPackets(2)
    console.setResponding(true)
    console.setStatus("STANDBY")
    const state = await server.mqtt.waitForMessage(
      `ps5-mqtt/${server.deviceId}`,
      (payload) =>
        typeof payload === "object" &&
        payload.power === "STANDBY" &&
        payload.device_status === "online",
      15000,
    )
    expect(state).toMatchObject({ power: "STANDBY", device_status: "online" })
    expect(console.requests - requestsBefore).toBeGreaterThanOrEqual(3)
  }, 20000)
})
