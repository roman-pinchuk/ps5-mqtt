import { call, delay, getContext } from "redux-saga/effects"
import { runSaga } from "redux-saga"
import type { PlayactorClient } from "../../../playactor/client"
import { PLAYACTOR_CLIENT } from "../../../services"

import { Settings, SETTINGS } from "../../../services"
import { checkDevicesState } from "../check-devices-state"
import { pollDevices } from "../poll-devices"

describe("Poll devices saga", () => {
  test("waits for a device check before scheduling the next poll", () => {
    const settings = <Settings>{ checkDevicesInterval: 5000 }
    const generator = pollDevices()

    expect(generator.next().value).toEqual(getContext(SETTINGS))
    expect(generator.next(settings).value).toEqual(call(checkDevicesState))
    expect(generator.next().value).toEqual(delay(settings.checkDevicesInterval))
  })

  test("does not overlap or cancel a pending check when the interval elapses", async () => {
    jest.useFakeTimers()
    let respond!: (value: { status: "AWAKE" }) => void
    const pending = new Promise<{ status: "AWAKE" }>((resolve) => {
      respond = resolve
    })
    const client: PlayactorClient = {
      wake: jest.fn(),
      standby: jest.fn(),
      check: jest.fn().mockReturnValue(pending),
    }
    const task = runSaga(
      {
        context: {
          [SETTINGS]: { checkDevicesInterval: 100 },
          [PLAYACTOR_CLIENT]: client,
        },
        getState: () => ({
          devices: {
            ps5: {
              address: { address: "127.0.0.1" },
              status: "STANDBY",
              available: true,
            },
          },
        }),
        dispatch: jest.fn(),
      },
      pollDevices,
    )
    try {
      await jest.advanceTimersByTimeAsync(1000)
      expect(client.check).toHaveBeenCalledTimes(1)
      respond({ status: "AWAKE" })
      await jest.advanceTimersByTimeAsync(99)
      expect(client.check).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(1)
      expect(client.check).toHaveBeenCalledTimes(2)
    } finally {
      task.cancel()
      await task.toPromise()
      jest.useRealTimers()
    }
  })
})
