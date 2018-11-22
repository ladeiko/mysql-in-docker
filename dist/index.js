"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const crypto = require('crypto');
const mysql = require('mysql');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const niv = require('npm-install-version');
const sequelize3Class = () => {
    try {
        return require('sequelize3');
    }
    catch (e) {
        niv.install('sequelize@3.30.2', { destination: 'sequelize3' });
        return require('sequelize3');
    }
};
const sequelizeClass = require('sequelize');
const _ = require('lodash');
const nodeCleanup = require('node-cleanup');
const { execSync } = require('child_process');
const runningContainers = [];
function cleanup() {
    _.each(runningContainers, value => {
        try {
            execSync(`docker stop ${value}`);
        }
        catch (e) {
        }
    });
    _.remove(runningContainers);
}
nodeCleanup(() => {
    cleanup();
});
function run(options) {
    return __awaiter(this, arguments, void 0, function* () {
        const cmd = options.cmd;
        const args = _.castArray(options.args || []);
        const cwd = options.cwd;
        const verbose = options.verbose || false;
        if (!cmd) {
            throw new Error('No command specified');
        }
        if (verbose) {
            console.log('run', arguments);
        }
        return new Promise((resolve, reject) => {
            const child = spawn(cmd, args, { detached: false, cwd: cwd });
            let stdout = '';
            child.stdout.on('data', data => {
                const s = data.toString();
                stdout += s;
                if (verbose) {
                    process.stdout.write(s);
                }
            });
            child.stderr.on('data', data => {
                const s = data.toString();
                stdout += s;
                if (verbose) {
                    process.stderr.write(s);
                }
            });
            child.on('close', code => {
                if (code === 0) {
                    resolve(stdout);
                }
                else {
                    reject(code);
                }
            });
        });
    });
}
function generateFreePort() {
    return __awaiter(this, void 0, void 0, function* () {
        while (true) {
            const port = Math.ceil(Math.random() * 20000 + 45000);
            try {
                yield run({ cmd: 'nc', args: ['-z', '127.0.0.1', port] });
            }
            catch (e) {
                return port;
            }
        }
    });
}
function rndStr() {
    return crypto.randomBytes(16).toString('hex');
}
class MySqlContainer {
    constructor(options) {
        this._runtime = {};
        this._pool = null;
        this._options = options || {};
        this._validateOptions();
        if (this._options.mysqlV8) {
            this._dockerFileName = 'Dockerfile8';
        }
        else {
            this._dockerFileName = 'Dockerfile5';
        }
        this._dockerFileHash = crypto
            .createHash('md5')
            .update(fs.readFileSync(__dirname + '/' + this._dockerFileName, {
            encoding: 'utf8'
        }))
            .digest('hex');
        this._dockerImageName = MySqlContainer.prefix + this._dockerFileHash;
        this._dockerContainerName = MySqlContainer.prefix + this._dockerFileHash + rndStr();
        this._dbOptions = {
            user: this._options.user || rndStr(),
            password: this._options.password || rndStr(),
            database: this._options.database || rndStr(),
            host: '127.0.0.1',
            operatorsAliases: false
        };
    }
    static cleanup() {
        cleanup();
    }
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!_.isEmpty(this._runtime)) {
                throw new Error('Already running');
            }
            const modelsDir = this._options.models;
            const sqlScriptsFolder = this._options.scriptsDir;
            const port = yield this._startContainer();
            const connect = () => {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    if (!this._pool) {
                        this._pool = mysql.createPool({
                            waitForConnections: true,
                            queueLimit: 0,
                            connectionLimit: 10,
                            host: this._dbOptions.host,
                            port: port,
                            database: this._dbOptions.database,
                            user: this._dbOptions.user,
                            password: this._dbOptions.password,
                            timezone: 'Z',
                            multipleStatements: true
                        });
                    }
                    resolve(this._pool);
                }));
            };
            const execSql = query => {
                let log = this._options.verbose || false;
                if (/^.+\.sql$/.test(query)) {
                    if (!sqlScriptsFolder) {
                        throw new Error(`${query} not found`);
                    }
                    const file = path.join(sqlScriptsFolder, query);
                    query = fs.readFileSync(file, 'utf8');
                    log = false;
                }
                query = query
                    .replace(/DELIMITER.+?\n/gim, '')
                    .replace(/\/\*.+?\*\/\s*;?/gim, '')
                    .replace(/--.*?\n/gim, '\n')
                    .replace(/START\s+TRANSACTION;/gim, '\n')
                    .replace(/COMMIT;/gim, '\n')
                    .replace(/\n\n+/gim, '\n')
                    .replace(/\n\$\$\n/gim, ';\n');
                if (log) {
                    console.log(`SQL: ${query}`);
                }
                return new Promise((resolve, reject) => {
                    connect()
                        .then((pool) => {
                        pool.query(query, (err, rows) => {
                            if (err) {
                                reject(err);
                            }
                            else {
                                if (log && /^SELECT\s+/i.test(query)) {
                                    console.log(`RESULT: ${JSON.stringify(rows, null, 2)}`);
                                }
                                resolve(rows);
                            }
                        });
                        return null;
                    })
                        .catch(reject);
                });
            };
            const loadModels = () => {
                const options = _.chain(this._dbOptions)
                    .cloneDeep()
                    .assign({
                    pool: { max: 0, evict: 0 },
                    port: port,
                    dialect: 'mysql',
                    timezone: '+00:00',
                    logging: this._options.verbose
                        ? console.log.bind(console)
                        : () => {
                        }
                })
                    .value();
                const currentSequelizeClass = this._options.sequelizeV3 ? sequelize3Class() : sequelizeClass;
                const sequelize = new currentSequelizeClass(options.database, options.user, options.password, options);
                const loadedModels = _.castArray(modelsDir).reduce((finalAcc, dir) => {
                    if (/.(js|ts)$/.test(dir)) {
                        const model = sequelize.import(dir);
                        finalAcc[model.name] = model;
                        return finalAcc;
                    }
                    return fs
                        .readdirSync(dir)
                        .filter(v => /.(js|ts)$/.test(v))
                        .reduce((acc, value) => {
                        const model = sequelize.import(path.join(dir, value));
                        acc[model.name] = model;
                        return acc;
                    }, finalAcc);
                }, {});
                _.each(Object.values(loadedModels), model => {
                    if (_.isFunction(model.associate)) {
                        model.associate({
                            getModelByName: name => {
                                return loadedModels[name];
                            }
                        });
                    }
                });
                Object.defineProperty(loadedModels, 'close', {
                    value: () => __awaiter(this, void 0, void 0, function* () {
                        sequelize.close();
                    }),
                    writable: false
                });
                return sequelize.sync().then(() => {
                    return loadedModels;
                });
            };
            const models = !_.isEmpty(modelsDir) ? yield loadModels() : null;
            this._runtime = {
                port: port,
                host: this._dbOptions.host,
                database: this._dbOptions.database,
                user: this._dbOptions.user,
                password: this._dbOptions.password,
                models: models,
                execSql: execSql
            };
        });
    }
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            if (_.isEmpty(this._runtime)) {
                return;
            }
            yield this._stopContainer();
            if (this._pool) {
                yield new Promise(resolve => {
                    this._pool.end(() => {
                        this._pool = null;
                        resolve();
                    });
                });
            }
            _.pull(runningContainers, this._dockerContainerName);
            this._runtime = {};
        });
    }
    model(name) {
        return this._runtime.models[name];
    }
    execSql() {
        return this._runtime.execSql.apply(null, Array.from(arguments));
    }
    get port() {
        return this._runtime.port;
    }
    get host() {
        return this._runtime.host;
    }
    get database() {
        return this._runtime.database;
    }
    get user() {
        return this._runtime.user;
    }
    get password() {
        return this._runtime.password;
    }
    _validateOptions() {
    }
    _stopContainer() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield run({ cmd: 'docker', args: ['stop', this._dockerContainerName] });
            }
            catch (e) {
            }
            try {
                yield run({ cmd: 'docker', args: ['rm', this._dockerContainerName] });
            }
            catch (e) {
            }
        });
    }
    _startContainer() {
        return __awaiter(this, void 0, void 0, function* () {
            const port = yield generateFreePort();
            yield run({
                verbose: this._options.verbose,
                cmd: 'docker',
                args: ['build', '-f', this._dockerFileName, '-t', this._dockerImageName, '.'],
                cwd: __dirname
            });
            const volumes = [];
            if (this._options.storage) {
                const stat = fs.statSync(this._options.storage);
                if (!stat.isDirectory()) {
                    throw new Error(`${this._options.storage} is not directory`);
                }
                volumes.push([path.normalize(this._options.storage), '/var/lib/mysql']);
            }
            yield run({
                verbose: this._options.verbose,
                cmd: 'docker',
                args: [
                    'run',
                    '-d',
                    '-it',
                    '--rm',
                    '--name',
                    this._dockerContainerName,
                    '-e',
                    `MYSQL_ROOT_PASSWORD=${rndStr()}`,
                    '-e',
                    `MYSQL_DATABASE=${this._dbOptions.database}`,
                    '-e',
                    `MYSQL_USER=${this._dbOptions.user}`,
                    '-e',
                    `MYSQL_PASSWORD=${this._dbOptions.password}`,
                    '-p',
                    `127.0.0.1:${port}:3306/tcp`
                ]
                    .concat(_.chain(volumes)
                    .map(value => ['--mount', `type=bind,source=${value[0]},target=${value[1]}`])
                    .flatten()
                    .value())
                    .concat([this._dockerImageName])
            });
            runningContainers.push(this._dockerContainerName);
            yield run({
                verbose: this._options.verbose,
                cmd: 'docker',
                args: ['exec', this._dockerContainerName, '/bin/bash', '-c', 'until nc -z 127.0.0.1 3306; do sleep 1; done; echo "";']
            });
            return port;
        });
    }
}
MySqlContainer.prefix = 'mysql-in-docker-';
module.exports = MySqlContainer;
//# sourceMappingURL=index.js.map