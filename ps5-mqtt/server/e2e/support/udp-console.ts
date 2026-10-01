import dgram from "dgram"

/** A loopback console answering the real PlayActor discovery protocol. */
export async function startUdpConsole(id: string) {
  const socket = dgram.createSocket("udp4")
  let status: "STANDBY" | "AWAKE" = "STANDBY"
  let responding = true
  let droppedPackets = 0
  let requests = 0

  socket.on("message", (message, sender) => {
    if (!message.toString().startsWith("SRCH")) return
    requests++
    if (!responding) return
    if (droppedPackets > 0) {
      droppedPackets--
      return
    }
    const response = Buffer.from(
      [
        status === "STANDBY"
          ? "HTTP/1.1 620 Server Standby"
          : "HTTP/1.1 200 Ok",
        `host-id:${id}`,
        `host-name:${id}`,
        "host-type:PS5",
        "host-request-port:997",
        "system-version:00000000",
        "device-discovery-protocol-version:00030010",
        "",
      ].join("\n"),
    )
    socket.send(response, sender.port, sender.address)
  })

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject)
    socket.bind(9302, "127.0.0.1", () => {
      socket.removeListener("error", reject)
      resolve()
    })
  })

  return {
    setStatus(value: typeof status) {
      status = value
    },
    setResponding(value: boolean) {
      responding = value
    },
    dropNextPackets(count: number) {
      droppedPackets = count
    },
    get requests() {
      return requests
    },
    stop: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  }
}
