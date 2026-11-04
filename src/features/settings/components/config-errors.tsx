/**
 * Main's refusals from the last config write (`snapshot.errors`), verbatim: they name the OS error or the rule that
 * refused, which is what makes them fixable (HIVE-388).
 */
export function ConfigErrors({ errors }: { errors: readonly string[] }) {
  return errors.map((error) => (
    <p key={error} className="rounded-md border border-red px-2.5 py-1.5 text-ui-sm text-red">
      {error}
    </p>
  ));
}
