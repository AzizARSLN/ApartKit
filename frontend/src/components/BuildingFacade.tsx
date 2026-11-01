const FLOORS = 6;
const COLUMNS = 4;
const LIT = new Set(["0-2", "1-0", "1-3", "2-1", "3-3", "4-0", "4-2", "5-1"]);

export function BuildingFacade() {
  return (
    <svg className="login-facade" viewBox="0 0 560 720" preserveAspectRatio="xMidYMax meet" aria-hidden>
      <rect x="0" y="340" width="110" height="380" fill="#b93d1e" />
      <rect x="470" y="250" width="90" height="470" fill="#b93d1e" />
      <path d="M390 60V10M372 28h36" stroke="#17161f" strokeWidth="3" />
      <rect x="90" y="60" width="380" height="660" fill="#17161f" />
      {Array.from({ length: FLOORS }, (_, floor) =>
        Array.from({ length: COLUMNS }, (_, column) => (
          <rect
            key={`${floor}-${column}`}
            x={118 + column * 84}
            y={88 + floor * 90}
            width="56"
            height="62"
            fill={LIT.has(`${floor}-${column}`) ? "#f6e7c8" : "#2c2b38"}
          />
        )),
      )}
      <rect x="244" y="632" width="72" height="88" fill="#f6e7c8" />
      <path d="M280 632v88" stroke="#17161f" strokeWidth="3" />
    </svg>
  );
}
