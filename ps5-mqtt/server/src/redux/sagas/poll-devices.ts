import { call, delay, getContext } from "redux-saga/effects"
import { Settings, SETTINGS } from "../../services"
import { createErrorLogger } from "../../util/error-logger"
import { checkDevicesState } from "./check-devices-state"

const debugError = createErrorLogger()

function* pollDevices() {
  const { checkDevicesInterval }: Settings = yield getContext(SETTINGS)

  while (true) {
    try {
      yield call(checkDevicesState)
      yield delay(checkDevicesInterval)
    } catch (e) {
      debugError(e)
    }
  }
}

export { pollDevices }
