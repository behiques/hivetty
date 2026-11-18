/**
 * Where a main → renderer push actually goes (HIVE-141).
 *
 * There is one fan-out point in the whole main tree, and it has been one since
 * story 106 put the notifier tap there rather than at each source. This
 * interface is that point given a name, so server mode can supply a second
 * implementation that writes to attached sockets without any of the 114 handler
 * bodies learning a socket exists.
 *
 * Deliberately one method. A `Broadcaster` does not know about the notifier, the
 * channel taxonomy, or which surfaces are attached — it takes a channel and a
 * payload and delivers them. The tap lives in `registerIpcHandlers`' own `send`,
 * one layer up, which is what lets the three notification pushes below reach
 * every surface while still bypassing the tap.
 */
export interface Broadcaster {
  /**
   * Deliver to every attached surface. Never throws: a failed delivery must not
   * cost a `pty:data`, and a caller in the typing path has nothing useful to do
   * with the failure anyway.
   */
  emit(channel: string, payload: unknown): void;
}
