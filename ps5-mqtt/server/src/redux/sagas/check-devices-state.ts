import createDebugger from "debug"
import { Discovery } from "playactor/dist/discovery"
import { IDiscoveredDevice } from "playactor/dist/discovery/model"
import { call, put, select } from "redux-saga/effects"
import { createErrorLogger } from "../../util/error-logger"
import { updateHomeAssistant } from "../action-creators"
import { getDeviceList } from "../selectors"
import type { Device } from "../types"

const debug = createDebugger("@ha:ps5:checkDevicesState")
const errorLogger = createErrorLogger()

async function checkDevice(
  address: string,
): Promise<IDiscoveredDevice | undefined> {
  const discovery = new Discovery({ deviceIp: address })

  for await (const device of discovery.discover(
    {},
    { timeoutMillis: 5000 },
  )) {
    return device
  }

  return undefined
}

function* checkDevicesState() {
  const devices: Device[] = yield select(getDeviceList)
  for (const device of devices) {
    try {
      const discoveredDevice: IDiscoveredDevice | undefined = yield call(
        checkDevice,
        device.address.address,
      )

      if (!discoveredDevice) {
        throw (
          "No data received from Playstation. If this error continues, " +
          "your Playstation is likely powered off or unreachable - it will " +
          "not be available until it is in either rest mode/powered on and reachable."
        )
      }

      const updatedDevice = discoveredDevice as unknown as Device

      if (device.transitioning) {
        debug(
          "Device is transitioning",
          device.transitioning,
          updatedDevice.status,
        )
        break
      }

      // only send updates if ps5 is truly changing states or when ps5 has become available
      if (device.status !== updatedDevice.status || !device.available) {
        debug("Update HA")
        yield put(
          updateHomeAssistant({
            ...device,
            status: updatedDevice.status,
            activity:
              updatedDevice.status !== "AWAKE"
                ? undefined
                : updatedDevice.activity,
            available: true,
          }),
        )
      }
    } catch (e) {
      // previously available ps5 cannot be located
      yield put(
        updateHomeAssistant({
          ...device,
          status: "UNKNOWN",
          available: false,
          activity: undefined,
        }),
      )

      errorLogger(e)
    }
  }
}

export { checkDevicesState }
