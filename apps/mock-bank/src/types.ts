export interface Account {
  id: string;
  type: "savings" | "checking";
  balance: number;
}

export interface Member {
  id: string;
  name: string;
  eligible: boolean;
  ineligibleReason?: string;
  accounts: Account[];
}
