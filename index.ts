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
    niv.install('sequelize@3.30.2', { destination: 'sequelize3'});
    return require('sequelize3');
  }
};

const sequelizeClass = require('sequelize');
const _ = require('lodash');
const nodeCleanup = require('node-cleanup');
const { execSync } = require('child_process');


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

const runningContainers: string[] = [];

function cleanup() {
  _.each(runningContainers, value => {
    try {
      execSync(`docker stop ${value}`);
    } catch (e) {
      /* ignore */
    }
  });
  _.remove(runningContainers);
}

nodeCleanup((/*exitCode, signal*/) => {
  cleanup();
});

async function run(options: any) {
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
      } else {
        reject(code);
      }
    });
  });
}

async function generateFreePort() {
  while (true) {
    const port = Math.ceil(Math.random() * 20000 + 45000);
    try {
      await run({ cmd: 'nc', args: ['-z', '127.0.0.1', port] });
    } catch (e) {
      return port;
    }
  }
}

function rndStr() {
  return crypto.randomBytes(16).toString('hex');
}

class MySqlContainer {
  public static cleanup() {
    cleanup();
  }

  /** @internal */
  private static readonly prefix = 'mysql-in-docker-';

  /** @internal */
  private readonly _options: IMySqlInDockerOptions;

  /** @internal */
  private readonly _dockerFileName: string;

  /** @internal */
  private readonly _dockerFileHash: string;

  /** @internal */
  private readonly _dockerImageName: string;

  /** @internal */
  private readonly _dockerContainerName: string;

  /** @internal */
  private _runtime: any = {};

  /** @internal */
  private _pool: any | null = null;

  /** @internal */
  private _dbOptions: any;

  constructor(options?: IMySqlInDockerOptions) {
    this._options = options || {};
    this._validateOptions();
    if (this._options.mysqlV8) {
      this._dockerFileName = 'Dockerfile8';
    } else {
      this._dockerFileName = 'Dockerfile5';
    }
    this._dockerFileHash = crypto
      .createHash('md5')
      .update(
        fs.readFileSync(__dirname + '/' + this._dockerFileName, {
          encoding: 'utf8'
        })
      )
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

  public async start() {
    if (!_.isEmpty(this._runtime)) {
      throw new Error('Already running');
    }

    const modelsDir = this._options.models;
    const sqlScriptsFolder = this._options.scriptsDir;

    const port = await this._startContainer();

    const connect = () => {
      return new Promise(async (resolve, reject) => {
        if (!this._pool) {
          this._pool = mysql.createPool({
            waitForConnections: true,
            queueLimit: 0, // unlimited
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
      });
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
        /* eslint-disable no-console */
        console.log(`SQL: ${query}`);
        /* eslint-enable no-console */
      }

      return new Promise((resolve, reject) => {
        connect()
          .then((pool: any) => {
            pool.query(query, (err, rows) => {
              if (err) {
                reject(err);
              } else {
                if (log && /^SELECT\s+/i.test(query)) {
                  /* eslint-disable no-console */
                  console.log(`RESULT: ${JSON.stringify(rows, null, 2)}`);
                  /* eslint-enable no-console */
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
      const options: any = _.chain(this._dbOptions)
        .cloneDeep()
        .assign({
          pool: { max: 0, evict: 0 },
          port: port,
          dialect: 'mysql',
          timezone: '+00:00',
          logging: this._options.verbose
            ? console.log.bind(console)
            : () => {
                /* noop */
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
            // emulate database nodejs-code-server database
            getModelByName: name => {
              return loadedModels[name];
            }
          });
        }
      });

      Object.defineProperty(loadedModels, 'close', {
        value: async () => {
          sequelize.close();
        },
        writable: false
      });

      return sequelize.sync().then(() => {
        return loadedModels;
      });
    };

    const models = !_.isEmpty(modelsDir) ? await loadModels() : null;

    this._runtime = {
      port: port,
      host: this._dbOptions.host,
      database: this._dbOptions.database,
      user: this._dbOptions.user,
      password: this._dbOptions.password,
      models: models,
      execSql: execSql
    };
  }

  public async stop() {
    if (_.isEmpty(this._runtime)) {
      return;
    }
    await this._stopContainer();
    if (this._pool) {
      await new Promise(resolve => {
        this._pool.end(() => {
          this._pool = null;
          resolve();
        });
      });
    }
    _.pull(runningContainers, this._dockerContainerName);
    this._runtime = {};
  }

  public model(name): any | undefined {
    return this._runtime.models[name];
  }

  public execSql(): [any] {
    return this._runtime.execSql.apply(null, Array.from(arguments));
  }

  public get port(): number | undefined {
    return this._runtime.port;
  }

  public get host(): string | undefined {
    return this._runtime.host;
  }

  public get database(): string | undefined {
    return this._runtime.database;
  }

  public get user(): string | undefined {
    return this._runtime.user;
  }

  public get password(): string | undefined {
    return this._runtime.password;
  }

  /** @internal */
  private _validateOptions() {
    // TODO
  }

  /** @internal */
  private async _stopContainer() {
    try {
      await run({ cmd: 'docker', args: ['stop', this._dockerContainerName] });
    } catch (e) {
      // empty
    }
    try {
      await run({ cmd: 'docker', args: ['rm', this._dockerContainerName] });
    } catch (e) {
      // empty
    }
  }

  /** @internal */
  private async _startContainer() {
    const port = await generateFreePort();

    await run({
      verbose: this._options.verbose,
      cmd: 'docker',
      args: ['build', '-f', this._dockerFileName, '-t', this._dockerImageName, '.'],
      cwd: __dirname
    });

    const volumes: any[] = [];

    if (this._options.storage) {
      const stat = fs.statSync(this._options.storage);
      if (!stat.isDirectory()) {
        throw new Error(`${this._options.storage} is not directory`);
      }
      volumes.push([path.normalize(this._options.storage), '/var/lib/mysql']);
    }

    await run({
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
        .concat(
          _.chain(volumes)
            .map(value => ['--mount', `type=bind,source=${value[0]},target=${value[1]}`])
            .flatten()
            .value()
        )
        .concat([this._dockerImageName])
    });

    runningContainers.push(this._dockerContainerName);

    await run({
      verbose: this._options.verbose,
      cmd: 'docker',
      args: ['exec', this._dockerContainerName, '/bin/bash', '-c', 'until nc -z 127.0.0.1 3306; do sleep 1; done; echo "";']
    });

    return port;
  }
}

export = MySqlContainer;
