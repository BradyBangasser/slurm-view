const fs = require('fs');
const os = require('os');
const path = require('path');
const YAML = require('yaml');
const {
    loadRuntimeConfig,
    writeUserConfigOverride,
    getUserOverrideFilePath,
    resetRuntimeConfigForTests
} = require('../../../src/server/config/runtime-config');

function createTempConfigDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'slurm-view-config-'));
}

function writeConfigFile(configDir, fileName, content) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, fileName), content, 'utf8');
}

const BASE_CONFIG_LINES = [
    'stats:',
    '  cpuLoad:',
    '    thresholds:',
    '      lowMax: 0.33',
    '      mediumMax: 0.66',
    'ui:',
    '  charts:',
    '    cpu:',
    '      showSecondaryLayer: true',
    '    memory:',
    '      showSecondaryLayer: true',
    '    gpu:',
    '      showSecondaryLayer: true',
    '  navbar:',
    '    enabled: true',
    '    title: Slurm View',
    '    color: "#0f766e"',
    'topology:',
    '  pods:',
    '    - name: PodA',
    '      racks:',
    '        - id: A01',
    '          nodes:',
    '            - name: node01',
    '              u: 1',
    '        - id: B02',
    '          nodes:',
    '            - name: node02',
    '              u: 1'
];

describe('writeUserConfigOverride', () => {
    let systemConfigDir;
    let userConfigDir;

    beforeEach(() => {
        systemConfigDir = createTempConfigDir();
        userConfigDir = createTempConfigDir();
        writeConfigFile(systemConfigDir, 'default.yaml', BASE_CONFIG_LINES.join('\n'));
    });

    afterEach(() => {
        resetRuntimeConfigForTests();
        [systemConfigDir, userConfigDir].forEach((dir) => {
            if (dir && fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    test('writes a new user override file and the merged config reflects it', () => {
        const options = { systemConfigDir, userConfigDir };
        loadRuntimeConfig(options);

        const result = writeUserConfigOverride({ topology: { maxRacksPerRow: 9 } }, options);

        expect(result.topology.maxRacksPerRow).toBe(9);
        const filePath = getUserOverrideFilePath(userConfigDir);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(YAML.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ topology: { maxRacksPerRow: 9 } });
    });

    test('a second write merges with, rather than erasing, the first', () => {
        const options = { systemConfigDir, userConfigDir };

        writeUserConfigOverride({ topology: { maxRacksPerRow: 4 } }, options);
        const result = writeUserConfigOverride({ topology: { rackOrder: ['A01', 'B02'] } }, options);

        expect(result.topology.maxRacksPerRow).toBe(4);
        expect(result.topology.rackOrder).toEqual(['A01', 'B02']);
    });

    test('rejects an admin-owned key (topology.pods) before touching disk', () => {
        const options = { systemConfigDir, userConfigDir };
        const filePath = getUserOverrideFilePath(userConfigDir);

        expect(() => writeUserConfigOverride({ topology: { pods: [] } }, options)).toThrow();
        expect(fs.existsSync(filePath)).toBe(false);
    });

    test('rejects an out-of-range value and leaves the existing file untouched', () => {
        const options = { systemConfigDir, userConfigDir };
        writeUserConfigOverride({ topology: { maxRacksPerRow: 5 } }, options);
        const filePath = getUserOverrideFilePath(userConfigDir);
        const before = fs.readFileSync(filePath, 'utf8');

        expect(() => writeUserConfigOverride({ topology: { maxRacksPerRow: 999 } }, options)).toThrow();
        expect(fs.readFileSync(filePath, 'utf8')).toBe(before);

        const reloaded = loadRuntimeConfig(options);
        expect(reloaded.topology.maxRacksPerRow).toBe(5);
    });

    test('creates the user config directory if it does not exist yet', () => {
        fs.rmSync(userConfigDir, { recursive: true, force: true });
        const options = { systemConfigDir, userConfigDir };

        const result = writeUserConfigOverride({ topology: { maxRacksPerRow: 7 } }, options);

        expect(result.topology.maxRacksPerRow).toBe(7);
        expect(fs.existsSync(getUserOverrideFilePath(userConfigDir))).toBe(true);
    });
});
