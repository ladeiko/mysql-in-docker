# mysql-in-docker

## Purpose

Module starts mysql server inside docker container. This is helpful while testing.

## Installation

```
npm i mysql-in-docker --save
```

## Usage

### IMySqlInDockerOptions options

```
interface IMySqlInDockerOptions {

  // database name to create [optional]
  database?: string;

  // database user name to create [optional]
  user?: string;

  // database user password to create [optional]
  password?: string;

  // if true, then sequelize v3 will be used for models [optional]
  sequelizeV3?: boolean;

  // use mysql v8, by default v5 is used [optional]
  mysqlV8?: boolean;

  // path to folder(s)/file(s) with sequelize models [optional]
  models?: string | string[];

  // path with sql scripts [optional]
  // this path is used when you specify 'my-query.sql' in query instead of
  // sql query, module tries to locate 'my-query.sql' inside this folder
  scriptsDir?: string;

  // if true, all actions will be logged to console, default is false [optional]
  verbose?: boolean;

  // if specified, then it will be used to store mysql database after shutdown
  // note: should be accessible by docker
  storage?: string;
}
```

### Methods

#### constructor(options?: IMySqlInDockerOptions)
Constructor

#### start()

Starts docker container with mysql server.
If succeeded, then ```port```, ```host```, etc. properties become available.

#### stop()
Stops running docker container.
After completion all ```port```, ```host```, etc. properties become unavailable.

#### execSql(query: string) => \[RowDataPacket\]

Returns method to be used to execute SQL queries. Query also can contain
name of the file to be executed, e.g: my-query.sql. Returns rows.

#### model(name) => SequelizeModel | undefined

Return sequelize model by name, if they where loaded from specified path(s).

### Properties

#### host: string | undefined

Returns domain or ip of running MySql server.

#### port: number | undefined

Returns port MySql server is listening to.

#### database: string | undefined

Returns name of database.

#### user: string | undefined

Returns mysql user.

#### password: string | undefined

Returns mysql password for user.

### Example

```
const MySqlContainer  = require('mysql-in-docker');

async function main() {
  const options = {
    // See IMySqlInDockerOptions
  };

  // instantiate
  const container = new MySqlContainer(options);

  // boot
  await container.start();

  const port = container.port;
  const host = container.host;
  const database = container.database;
  const user = container.user;
  const password = container.password;

  // do some work
  ...

  // shutdown
  await container.stop();
}

```

or if you want to you storage:

```
const MySqlContainer  = require('mysql-in-docker');

async function main() {
  const options = {
    // See IMySqlInDockerOptions

    storage: '/my-path'

    // we should explicitly specify database, user and password
    //  to be able to use it after restore
    database: 'test',
    user: 'test',
    password: 'test',
  };

  // instantiate
  const container = new MySqlContainer(options);

  // boot
  await container.start();

  const port = container.port;
  const host = container.host;
  const database = container.database;
  const user = container.user;
  const password = container.password;

  // do some work
  ...

  // shutdown
  await container.stop();

  // Restore after some from the same storage
  await container.start();

  // Work with restored database
  ...

  // shutdown again
  await container.stop();
}

```

## License

MIT. See [LICENSE](LICENSE)

## Author

Siarhei Ladzeika <sergey.ladeiko@gmail.com>
