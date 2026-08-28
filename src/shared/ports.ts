// One process listening on one port, as the Ports extension shows it.
//
// A row is a (pid, port) pair rather than a process: a server bound to both
// IPv4 and IPv6, or to several ports, is several rows, which is what someone
// looking for "who has 8080" wants to see.
export interface ListeningPort {
  pid: number
  command: string
  user: string
  // 'TCP' - the only kind that can be "listening" in the sense meant here.
  protocol: string
  // What it is bound to: '*', '127.0.0.1', '[::1]'.
  address: string
  port: number
}
