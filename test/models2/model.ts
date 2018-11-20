
function Model(sequelize, DataTypes) {

  const User = sequelize.define('User2', {
    name: DataTypes.STRING
  });

  return User;

}

export = Model;