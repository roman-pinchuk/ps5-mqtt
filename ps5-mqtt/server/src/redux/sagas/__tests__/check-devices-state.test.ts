import { Discovery } from "playactor/dist/discovery"
import { runSaga } from "redux-saga"

import { Device, State } from "../../types"
import { checkDevicesState } from "../check-devices-state"

jest.mock("playactor/dist/discovery")

const MockDiscovery = jest.mocked(Discovery)

const device: Device = {
  id: "ps5-id",
  name: "PS5",
  normalizedName: "ps5",
  transitioning: false,
  address: {
    address: "192.0.2.1",
    port: 9302,
  },
  systemVersion: "1.0",
  type: "PS5",
  status: "STANDBY",
  available: true,
}

describe("Check device state saga", () => {
  afterEach(() => {
    MockDiscovery.mockReset()
  })

  test("allows discovery retries before timing out", async () => {
    async function* discoveredDevices() {
      yield device
    }

    const discover = jest.fn().mockReturnValue(discoveredDevices())
    MockDiscovery.mockImplementation(
      () => ({ discover }) as unknown as Discovery,
    )

    await runSaga(
      {
        dispatch: () => {},
        getState: () =>
          <Partial<State>>{
            devices: { [device.id]: device },
          },
      },
      checkDevicesState,
    ).toPromise()

    expect(discover).toHaveBeenCalledWith({}, { timeoutMillis: 15000 })
  })
})
