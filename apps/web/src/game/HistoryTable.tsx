import type { Bet } from '@drop-win/contract';
import { formatMultiplier } from '@drop-win/fairness';
import { formatCents } from '../lib/money.ts';
import { verifyHash } from '../lib/route.ts';

interface HistoryTableProps {
  bets: readonly Bet[];
  hasMore: boolean;
  onLoadMore: () => void;
}

const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function HistoryTable({ bets, hasMore, onLoadMore }: HistoryTableProps) {
  if (bets.length === 0) {
    return (
      <>
        <h2>History</h2>
        <p className="empty">No bets yet. Each drop shows up here with a link to verify it.</p>
      </>
    );
  }
  return (
    <>
      <div className="table-scroll">
        <table>
          <caption>History</caption>
          <thead>
            <tr>
              <th scope="col" className="hide-narrow">
                Time
              </th>
              <th scope="col">Nonce</th>
              <th scope="col" className="num">
                Bet
              </th>
              <th scope="col">Game</th>
              <th scope="col" className="num">
                Result
              </th>
              <th scope="col" className="num">
                Profit
              </th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {bets.map((bet) => {
              const profit = bet.payoutCents - bet.amountCents;
              return (
                <tr key={bet.id}>
                  <td className="hide-narrow">
                    <time dateTime={new Date(bet.createdAt).toISOString()}>
                      {time.format(bet.createdAt)}
                    </time>
                  </td>
                  <td>{bet.nonce}</td>
                  <td className="num">{formatCents(bet.amountCents)}</td>
                  <td>
                    {bet.risk} · {bet.rows}
                  </td>
                  <td className="num">{formatMultiplier(bet.multiplierHundredths)}</td>
                  <td className={`num ${profit >= 0 ? 'win' : 'loss'}`}>
                    {profit >= 0 ? '+' : ''}
                    {formatCents(profit)}
                  </td>
                  <td>
                    <a
                      href={verifyHash({
                        ...(bet.serverSeed ? { serverSeed: bet.serverSeed } : {}),
                        serverSeedHash: bet.serverSeedHash,
                        clientSeed: bet.clientSeed,
                        nonce: bet.nonce,
                        rows: bet.rows,
                        risk: bet.risk,
                        expectedPath: bet.path,
                        expectedMultiplier: bet.multiplierHundredths,
                      })}
                      aria-label={`Verify bet with nonce ${String(bet.nonce)}`}
                    >
                      {bet.serverSeed ? 'Verify' : 'Details'}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button className="button small" type="button" onClick={onLoadMore}>
          Load older bets
        </button>
      )}
    </>
  );
}
