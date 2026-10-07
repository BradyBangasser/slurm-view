const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRuntimeConfig, resetRuntimeConfigForTests, SYSTEM_CONFIG_DIR_PATH } = require('../../../src/server/config/runtime-config');

function createTempConfigDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'slurm-view-topology-'));
}

function writeConfigFile(configDir, fileName, content) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, fileName), content, 'utf8');
}

function writeDefaults(configDir) {
    fs.copyFileSync(path.join(SYSTEM_CONFIG_DIR_PATH, 'default.yaml'), path.join(configDir, 'default.yaml'));
}

function topologyYaml(racksLines, header = []) {
    return [
        'topology:',
        ...header,
        '  pods:',
        '    - name: Compute',
        '      racks:',
        ...racksLines
    ].join('\n');
}

describe('runtime config topology', () => {
    let tempDirs;

    beforeEach(() => {
        tempDirs = [];
    });

    afterEach(() => {
        jest.restoreAllMocks();
        resetRuntimeConfigForTests();
        tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    });

    function configDir() {
        const dir = createTempConfigDir();
        tempDirs.push(dir);
        writeDefaults(dir);
        return dir;
    }

    function load(systemDir, userDir = null) {
        return loadRuntimeConfig({ systemConfigDir: systemDir, userConfigDir: userDir });
    }

    test('topology is optional', () => {
        const dir = configDir();

        expect(load(dir).topology).toBeUndefined();
    });

    test('loads a layout and applies rackHeight and box height defaults', () => {
        const dir = configDir();
        writeConfigFile(dir, 'topology.yaml', topologyYaml([
            '        - id: BK31',
            '          nodes:',
            '            - { name: "nova22-[1-4]", u: 40, height: 2 }',
            '            - { name: nova25-1, u: 37, verify: "check on tour" }'
        ]));

        expect(load(dir).topology).toEqual({
            rackHeight: 42,
            pods: [{
                name: 'Compute',
                racks: [{
                    id: 'BK31',
                    nodes: [
                        { name: 'nova22-[1-4]', u: 40, height: 2 },
                        { name: 'nova25-1', u: 37, height: 1, verify: 'check on tour' }
                    ]
                }]
            }]
        });
    });

    test('shipped example file is valid', () => {
        const dir = configDir();
        fs.copyFileSync(path.join(SYSTEM_CONFIG_DIR_PATH, 'topology.yaml.example'), path.join(dir, 'topology.yaml'));

        const topology = load(dir).topology;

        expect(topology.pods[0].racks.map((rack) => rack.id)).toEqual(['AA01', 'AA02']);
    });

    test('rejects unknown keys in a box', () => {
        const dir = configDir();
        writeConfigFile(dir, 'topology.yaml', topologyYaml([
            '        - id: AA01',
            '          nodes:',
            '            - { name: node01, u: 1, slot: 3 }'
        ]));

        expect(() => load(dir)).toThrow(/Configuration validation failed for topology\.yaml/);
    });

    test('rejects a box above the rack', () => {
        const dir = configDir();
        writeConfigFile(dir, 'topology.yaml', topologyYaml([
            '        - id: AA01',
            '          nodes:',
            '            - { name: gpu01, u: 40, height: 4 }'
        ]));

        expect(() => load(dir)).toThrow(/gpu01 in rack AA01 occupies U40-U43, above rackHeight 42/);
    });

    test('honors a custom rackHeight', () => {
        const dir = configDir();
        writeConfigFile(dir, 'topology.yaml', topologyYaml([
            '        - id: AA01',
            '          nodes:',
            '            - { name: node01, u: 48 }'
        ], ['  rackHeight: 48']));

        expect(load(dir).topology.rackHeight).toBe(48);
    });

    test('rejects overlapping boxes in one rack', () => {
        const dir = configDir();
        writeConfigFile(dir, 'topology.yaml', topologyYaml([
            '        - id: AA01',
            '          nodes:',
            '            - { name: "node[01-04]", u: 1, height: 2 }',
            '            - { name: node05, u: 2 }'
        ]));

        expect(() => load(dir)).toThrow(/node05 overlaps node\[01-04\] at U2 in rack AA01/);
    });

    test('rejects a node placed twice after hostlist expansion', () => {
        const dir = configDir();
        writeConfigFile(dir, 'topology.yaml', topologyYaml([
            '        - id: AA01',
            '          nodes:',
            '            - { name: "node[01-04]", u: 1, height: 2 }',
            '        - id: AA02',
            '          nodes:',
            '            - { name: node03, u: 1 }'
        ]));

        expect(() => load(dir)).toThrow(/node node03 is placed twice \(rack AA01 and rack AA02\)/);
    });

    test('rejects a rack listed twice', () => {
        const dir = configDir();
        writeConfigFile(dir, 'topology.yaml', topologyYaml([
            '        - id: AA01',
            '          nodes:',
            '            - { name: node01, u: 1 }',
            '        - id: AA01',
            '          nodes:',
            '            - { name: node02, u: 1 }'
        ]));

        expect(() => load(dir)).toThrow(/rack AA01 is listed twice/);
    });

    test('a user layout replaces the system layout whole', () => {
        const systemDir = configDir();
        writeConfigFile(systemDir, 'topology.yaml', topologyYaml([
            '        - id: AA01',
            '          nodes:',
            '            - { name: node01, u: 1 }'
        ]));
        const userDir = createTempConfigDir();
        tempDirs.push(userDir);
        writeConfigFile(userDir, 'topology.yaml', topologyYaml([
            '        - id: ZZ99',
            '          nodes:',
            '            - { name: node09, u: 9 }'
        ]));
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        const topology = load(systemDir, userDir).topology;

        expect(topology.pods[0].racks.map((rack) => rack.id)).toEqual(['ZZ99']);
    });
});
