import { call, delay, getContext } from "redux-saga/effects"

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
})
