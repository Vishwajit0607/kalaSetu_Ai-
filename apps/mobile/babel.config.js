module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // WatermelonDB needs legacy decorators for its @field / @text model props.
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // Reanimated's worklet plugin must stay last.
      'react-native-reanimated/plugin',
    ],
  };
};
