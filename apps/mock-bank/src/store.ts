import { Account, Member } from "./types";

export const MIN_INITIAL_DEPOSIT = 25;

/**
 * Seed dataset. Deliberately small: one eligible member (happy path +
 * validation-error path), one ineligible member (ACCOUNT_NOT_ELIGIBLE path).
 * Any member id not listed here naturally produces MEMBER_NOT_FOUND.
 */
const SEED: Member[] = [
  {
    id: "48213",
    name: "Jordan Lee",
    eligible: true,
    accounts: [
      { id: "SAV-48213-1", type: "savings", balance: 1250.0 },
      { id: "CHK-48213-1", type: "checking", balance: 340.12 },
    ],
  },
  {
    id: "50822",
    name: "Casey Morgan",
    eligible: false,
    ineligibleReason: "Account restricted: prior compliance hold",
    accounts: [{ id: "SAV-50822-1", type: "savings", balance: 88.4 }],
  },
];

let members: Map<string, Member>;
let accountSeq: number;
let confirmationSeq: number;

function cloneSeed(): Member[] {
  return SEED.map((member) => ({
    ...member,
    accounts: member.accounts.map((account) => ({ ...account })),
  }));
}

export function resetState(): void {
  members = new Map(cloneSeed().map((member) => [member.id, member]));
  accountSeq = 1;
  confirmationSeq = 1000;
}

resetState();

export function findMember(id: string): Member | undefined {
  return members.get(id);
}

function nextAccountNumber(memberId: string, type: Account["type"]): string {
  const n = accountSeq++;
  return `${type.toUpperCase().slice(0, 3)}-${memberId}-${n}`;
}

function nextConfirmationId(): string {
  return `CONF-${confirmationSeq++}`;
}

/**
 * The one mutating, irreversible action in this app: actually appends a new
 * account to the member's record. Called only from the confirm step, after
 * both the form-time and confirm-time validation have already passed.
 */
export function openAccount(
  memberId: string,
  type: Account["type"],
  deposit: number
): { account: Account; confirmationId: string } {
  const member = members.get(memberId);
  if (!member) {
    throw new Error(`Cannot open account: member ${memberId} not found`);
  }
  const account: Account = {
    id: nextAccountNumber(memberId, type),
    type,
    balance: deposit,
  };
  member.accounts.push(account);
  const confirmationId = nextConfirmationId();
  return { account, confirmationId };
}
