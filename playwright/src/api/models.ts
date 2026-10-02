export type AccountType = 'CHECKING' | 'SAVINGS' | 'TFSA' | 'RRSP';
export type CustomerType = 'PERSON' | 'BUSINESS';

export type RegistrationRequestData = {
    username: string;
    password: string;
};

export class RegistrationRequest {
    private readonly data: RegistrationRequestData;

    constructor(data: RegistrationRequestData) {
        this.data = data;
    }

    static builder() {
        return new RegistrationRequestBuilder();
    }

    toJSON(): RegistrationRequestData {
        return { ...this.data };
    }

    get username(): string {
        return this.data.username;
    }

    get password(): string {
        return this.data.password;
    }
}

class RegistrationRequestBuilder {
    private username = 'qa-user';
    private password = 'Password123!';

    withUsername(username: string): this {
        this.username = username;
        return this;
    }

    withPassword(password: string): this {
        this.password = password;
        return this;
    }

    build(): RegistrationRequest {
        return new RegistrationRequest({
            username: this.username,
            password: this.password,
        });
    }
}

export type CustomerProfileData = {
    name: string;
    address: string;
    dateOfBirth: string;
    type: CustomerType;
    kycVerified: boolean;
};

export class CustomerProfile {
    private readonly data: CustomerProfileData;

    constructor(data: CustomerProfileData) {
        this.data = data;
    }

    static builder() {
        return new CustomerProfileBuilder();
    }

    toJSON(): CustomerProfileData {
        return { ...this.data };
    }

    get name(): string {
        return this.data.name;
    }

    get address(): string {
        return this.data.address;
    }

    get dateOfBirth(): string {
        return this.data.dateOfBirth;
    }

    get type(): CustomerType {
        return this.data.type;
    }

    get kycVerified(): boolean {
        return this.data.kycVerified;
    }
}

class CustomerProfileBuilder {
    private name = 'Test Customer';
    private address = '123 Test Street';
    private dateOfBirth = '1990-01-01';
    private type: CustomerType = 'PERSON';
    private kycVerified = true;

    withName(name: string): this {
        this.name = name;
        return this;
    }

    withAddress(address: string): this {
        this.address = address;
        return this;
    }

    withDateOfBirth(dateOfBirth: string): this {
        this.dateOfBirth = dateOfBirth;
        return this;
    }

    withType(type: CustomerType): this {
        this.type = type;
        return this;
    }

    withKycVerified(kycVerified: boolean): this {
        this.kycVerified = kycVerified;
        return this;
    }

    build(): CustomerProfile {
        return new CustomerProfile({
            name: this.name,
            address: this.address,
            dateOfBirth: this.dateOfBirth,
            type: this.type,
            kycVerified: this.kycVerified,
        });
    }
}

export type AccountOpeningRequestData = {
    accountType: AccountType;
    balance: string;
    interestRate?: number;
};

export class AccountOpeningRequest {
    private readonly data: AccountOpeningRequestData;

    constructor(data: AccountOpeningRequestData) {
        this.data = data;
    }

    static builder() {
        return new AccountOpeningRequestBuilder();
    }

    toJSON(): AccountOpeningRequestData {
        if (this.data.interestRate === undefined) {
            return { accountType: this.data.accountType, balance: this.data.balance };
        }
        return { ...this.data };
    }

    get accountType(): AccountType {
        return this.data.accountType;
    }

    get balance(): string {
        return this.data.balance;
    }

    get interestRate(): number | undefined {
        return this.data.interestRate;
    }
}

class AccountOpeningRequestBuilder {
    private accountType: AccountType = 'CHECKING';
    private balance = '0.00';
    private interestRate?: number;

    withAccountType(accountType: AccountType): this {
        this.accountType = accountType;
        return this;
    }

    withBalance(balance: string): this {
        this.balance = balance;
        return this;
    }

    withInterestRate(interestRate: number): this {
        this.interestRate = interestRate;
        return this;
    }

    build(): AccountOpeningRequest {
        return new AccountOpeningRequest({
            accountType: this.accountType,
            balance: this.balance,
            interestRate: this.interestRate,
        });
    }
}

export type SavingsGoalRequestData = {
    goalName: string;
    targetAmount: number;
    targetDate: string;
};

export class SavingsGoalRequest {
    private readonly data: SavingsGoalRequestData;

    constructor(data: SavingsGoalRequestData) {
        this.data = data;
    }

    static builder() {
        return new SavingsGoalRequestBuilder();
    }

    toJSON(): SavingsGoalRequestData {
        return { ...this.data };
    }

    get goalName(): string {
        return this.data.goalName;
    }

    get targetAmount(): number {
        return this.data.targetAmount;
    }

    get targetDate(): string {
        return this.data.targetDate;
    }
}

class SavingsGoalRequestBuilder {
    private goalName = 'Emergency Fund';
    private targetAmount = 5000;
    private targetDate = '2030-12-31';

    withGoalName(goalName: string): this {
        this.goalName = goalName;
        return this;
    }

    withTargetAmount(targetAmount: number): this {
        this.targetAmount = targetAmount;
        return this;
    }

    withTargetDate(targetDate: string): this {
        this.targetDate = targetDate;
        return this;
    }

    build(): SavingsGoalRequest {
        return new SavingsGoalRequest({
            goalName: this.goalName,
            targetAmount: this.targetAmount,
            targetDate: this.targetDate,
        });
    }
}
