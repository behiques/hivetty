/**
 * The TOML values a Codex `-c key=value` override takes (HIVE-342), shared by headless runs and
 * interactive sessions (HIVE-279). Pure strings: every value HiveTTY puts on a Codex argv goes
 * through `toml`.
 */

/** Half a surrogate pair: JSON escapes it, but TOML holds Unicode scalar values only. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * A TOML basic string. JSON's escapes are a subset of TOML's, so `JSON.stringify` is one, apart
 * from the two strings it writes that TOML refuses: a raw DEL, and an escaped lone surrogate.
 */
export const toml = (value: string): string =>
  JSON.stringify(value.replace(LONE_SURROGATE, '�')).replace(/\u007f/g, '\\u007f');
export const tomlList = (values: readonly string[]): string => `[${values.map(toml).join(',')}]`;
export const tomlTable = (record: Record<string, string>): string =>
  `{${Object.entries(record)
    .map(([key, value]) => `${toml(key)}=${toml(value)}`)
    .join(',')}}`;

/** One hook event's `-c` value: a single matcher group running `command`. */
export const hookEntry = (event: string, command: string, matcher?: string): string =>
  `hooks.${event}=[{${matcher === undefined ? '' : `matcher=${toml(matcher)},`}hooks=[{type="command",command=${toml(command)}}]}]`;
