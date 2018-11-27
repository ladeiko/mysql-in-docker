const _ = require('lodash');
const os = require('os');
const tmp = require('tmp');
const path = require('path');
const should = require('should');
const MySqlContainer = require('..'); // tslint:disable-line

tmp.setGracefulCleanup();

describe('mysql-in-docker', () => {
  after(() => {
    MySqlContainer.cleanup();
  });

  if (process.argv.includes('---wtfnode')) {
    afterEach(() => {
      const wtf = require('wtfnode');
      wtf.dump();
    });
  }

  const testedConfigurations = [
    {
      sequelizeV3: false,
      mysqlV8: false
    },
    {
      sequelizeV3: false,
      mysqlV8: true
    },
    {
      sequelizeV3: true,
      mysqlV8: false
    },
    {
      sequelizeV3: true,
      mysqlV8: true
    }
  ];

  for (const options of testedConfigurations) {
    describe(`using options: ${JSON.stringify(options)}`, () => {
      it(`should start/stop`, async () => {
        const container = new MySqlContainer(options);

        should(container.port).be.undefined();
        should(container.host).be.undefined();
        should(container.database).be.undefined();
        should(container.user).be.undefined();
        should(container.password).be.undefined();

        await container.start();

        should(container.port)
          .be.instanceOf(Number)
          .and.greaterThan(0);
        should(container.host)
          .be.instanceOf(String)
          .and.not.empty();
        should(container.database)
          .be.instanceOf(String)
          .and.not.empty();
        should(container.user)
          .be.instanceOf(String)
          .and.not.empty();
        should(container.password)
          .be.instanceOf(String)
          .and.not.empty();

        const versions = await container.execSql('SELECT VERSION()');
        should(versions)
          .be.Array()
          .and.have.length(1);
        should(versions[0]['VERSION()'])
          .be.String()
          .and.startWith(options.mysqlV8 ? '8.' : '5.');

        await container.stop();

        should(container.port).be.undefined();
        should(container.host).be.undefined();
        should(container.database).be.undefined();
        should(container.user).be.undefined();
        should(container.password).be.undefined();
      });

      it(`should exec sql from string`, async () => {
        const container = new MySqlContainer(options);
        await container.start();

        await container.execSql(`CREATE TABLE t (c CHAR(20) CHARACTER SET utf8 COLLATE utf8_bin)`);
        await container.execSql(`INSERT INTO t (c) VALUES ('a')`);
        const rows = await container.execSql(`SELECT * FROM t`);

        should(rows)
          .be.instanceOf(Array)
          .and.has.length(1);
        should(rows[0])
          .have.property('c')
          .and.exactly('a');

        await container.stop();
      });

      it(`should exec sql from file`, async () => {
        const container = new MySqlContainer(
          _.assign(
            {
              scriptsDir: path.join(__dirname, 'scripts')
            },
            options
          )
        );

        await container.start();

        await container.execSql('test.sql');
        const rows = await container.execSql(`SELECT * FROM t`);

        should(rows)
          .be.instanceOf(Array)
          .and.has.length(1);
        should(rows[0])
          .have.property('c')
          .and.exactly('a');

        await container.stop();
      });

      it(`should load all models from dir`, async () => {
        const container = new MySqlContainer(
          _.assign(
            {
              models: path.join(__dirname, 'models')
            },
            options
          )
        );

        await container.start();

        const model = container.model('User');

        await model.create({
          name: 'a'
        });

        const rows = await model.findAll();

        should(rows)
          .be.instanceOf(Array)
          .and.has.length(1);
        should(rows[0])
          .have.property('name')
          .and.exactly('a');

        await container.stop();
      });

      it(`should load all models from multiple dirs`, async () => {
        const container = new MySqlContainer(
          _.assign(
            {
              models: [path.join(__dirname, 'models'), path.join(__dirname, 'models2')]
            },
            options
          )
        );

        await container.start();

        const test = async model => {
          await model.create({
            name: 'a'
          });

          const rows = await model.findAll();

          should(rows)
            .be.instanceOf(Array)
            .and.has.length(1);
          should(rows[0])
            .have.property('name')
            .and.exactly('a');
        };

        await test(container.model('User'));
        await test(container.model('User2'));

        await container.stop();
      });

      it(`should load models from files`, async () => {
        const container = new MySqlContainer(
          _.assign(
            {
              models: path.join(__dirname, 'models', 'model.ts')
            },
            options
          )
        );

        await container.start();

        const model = container.model('User');

        await model.create({
          name: 'a'
        });

        const rows = await model.findAll();

        should(rows)
          .be.instanceOf(Array)
          .and.has.length(1);
        should(rows[0])
          .have.property('name')
          .and.exactly('a');

        await container.stop();
      });

      it(`should load models from multiple files`, async () => {
        const container = new MySqlContainer(
          _.assign(
            {
              models: [path.join(__dirname, 'models', 'model.ts'), path.join(__dirname, 'models2', 'model.ts')]
            },
            options
          )
        );

        await container.start();

        const test = async model => {
          await model.create({
            name: 'a'
          });

          const rows = await model.findAll();

          should(rows)
            .be.instanceOf(Array)
            .and.has.length(1);
          should(rows[0])
            .have.property('name')
            .and.exactly('a');
        };

        await test(container.model('User'));
        await test(container.model('User2'));

        await container.stop();
      });

      it(`should load models from combination of dir and files`, async () => {
        const container = new MySqlContainer(
          _.assign(
            {
              models: [path.join(__dirname, 'models'), path.join(__dirname, 'models2', 'model.ts')]
            },
            options
          )
        );

        await container.start();

        const test = async model => {
          await model.create({
            name: 'a'
          });

          const rows = await model.findAll();

          should(rows)
            .be.instanceOf(Array)
            .and.has.length(1);
          should(rows[0])
            .have.property('name')
            .and.exactly('a');
        };

        await test(container.model('User'));
        await test(container.model('User2'));

        await container.stop();
      });

      it(`should use storage`, async () => {
        const tmpOptions: any = {
          unsafeCleanup: true
        };

        if (os.platform() !== 'win32') {
          tmpOptions.template = '/tmp/mysql-in-docker-XXXXXXXXXXXXXXXXXX';
        }

        const dir = tmp.dirSync(tmpOptions);
        const dirName = dir.name;

        // CREATE

        const container = new MySqlContainer(
          _.assign(
            {
              storage: dirName
            },
            options
          )
        );

        await container.start();

        await container.execSql(`CREATE TABLE t (c CHAR(20) CHARACTER SET utf8 COLLATE utf8_bin)`);
        await container.execSql(`INSERT INTO t (c) VALUES ('a')`);
        const rows = await container.execSql(`SELECT * FROM t`);

        should(rows)
          .be.instanceOf(Array)
          .and.has.length(1);
        should(rows[0])
          .have.property('c')
          .and.exactly('a');

        const database = container.database;
        const user = container.user;
        const password = container.password;

        await container.stop();

        // RESTORE

        const anotherContainer = new MySqlContainer(
          _.assign(
            {
              database: database,
              user: user,
              password: password,
              storage: dirName
            },
            options
          )
        );

        await anotherContainer.start();

        const restoredRows = await anotherContainer.execSql(`SELECT * FROM t`);

        should(restoredRows)
          .be.instanceOf(Array)
          .and.has.length(1);
        should(restoredRows[0])
          .have.property('c')
          .and.exactly('a');

        await anotherContainer.stop();

        dir.removeCallback();
      });

      it(`should support concurrent queries`, async () => {
        const container = new MySqlContainer(
          _.assign(
            {
              models: [path.join(__dirname, 'models'), path.join(__dirname, 'models2', 'model.ts')]
            },
            options
          )
        );

        await container.start();

        const test = async (i: number, model) => {
          const name = 'a' + i;
          await model.create({
            name: name
          });

          const rows = await model.findAll({
            where: {
              name: name
            }
          });

          should(rows)
            .be.instanceOf(Array)
            .and.has.length(1);
          should(rows[0])
            .have.property('name')
            .and.exactly(name);
        };

        await Promise.all(_.times(2000, i => test(i, container.model(i % 2 ? 'User' : 'User2'))));

        await container.stop();
      });
    });
  }
});
