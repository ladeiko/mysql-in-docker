interface IMySqlInDockerOptions {
    database?: string;
    user?: string;
    password?: string;
    sequelizeV3?: boolean;
    mysqlV8?: boolean;
    models?: string | string[];
    scriptsDir?: string;
    verbose?: boolean;
    storage?: string;
}
declare class MySqlContainer {
    static cleanup(): void;
    constructor(options?: IMySqlInDockerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    model(name: any): any | undefined;
    execSql(): [any];
    readonly port: number | undefined;
    readonly host: string | undefined;
    readonly database: string | undefined;
    readonly user: string | undefined;
    readonly password: string | undefined;
}
export = MySqlContainer;
