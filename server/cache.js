const store = new Map();

module.exports = {
  set(key, value) {
    store.set(key, value);
  },
  get(key) {
    return store.get(key);
  },
  getAll() {
    return Object.fromEntries(store);
  },
};
