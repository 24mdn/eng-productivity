import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { DrillDownRecord } from "@/lib/metrics-repository";
import { formatDateTime } from "@/lib/format";

/** The literal "receipts" requirement — every aggregate number drills down to these rows. */
export function DrillDownTable({ records }: { records: DrillDownRecord[] }) {
  if (records.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        No underlying records for this period.
      </p>
    );
  }

  // squadName is only ever populated on the exec/aggregate drill-down (records span multiple
  // squads there) — omitted entirely on the engineer view, where it'd just repeat one squad.
  const showSquad = records.some((r) => r.squadName);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          {showSquad && <TableHead>Squad</TableHead>}
          <TableHead>Record</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead>Actor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={record.id}>
            <TableCell className="text-muted-foreground">
              {formatDateTime(record.occurredAt)}
            </TableCell>
            {showSquad && (
              <TableCell className="text-muted-foreground">
                {record.squadName ?? "—"}
              </TableCell>
            )}
            <TableCell>
              <a
                href={record.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline-offset-2 hover:underline"
              >
                {record.title}
              </a>
            </TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">
              {record.detail}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {record.actorLogin ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
