import { assert } from 'chai';
import fs         from 'fs-extra';
import path       from 'path';

import FileUtil   from '../../src/FileUtil.js';

const fileUtil = new FileUtil({ relativePath: './test/fixture' });

// Empty test fixture directory.
fs.emptydirSync('./test/fixture');

// Note: to prevent `./test/fixture` from being emptied at the end of testing comment out the last test
// `emptyRelativePath`.

describe('FileUtil:', () =>
{
   it('writeFile', () =>
   {
      fileUtil.writeFile(writeData, 'test.js');
      fileUtil.writeFile(writeData, 'test2.js');

      assert.isTrue(fs.existsSync('./test/fixture/test.js'));
      assert.isTrue(fs.existsSync('./test/fixture/test2.js'));

      const readData = fs.readFileSync('./test/fixture/test.js').toString();
      const readData2 = fs.readFileSync('./test/fixture/test2.js').toString();

      assert.strictEqual(readData, writeData);
      assert.strictEqual(readData2, writeData);
   });

   it('readLines', () =>
   {
      const readLines = fileUtil.readLines('./test/fixture/test.js', 2, 10);

      assert.strictEqual(readLines.join('\n'), readLineData);
   });

   it('commonPath', () =>
   {
      const paths =
      [
         '/this/is/a/test/path/one/file.js',
         '/this/is/a/test/path/one/file2.js',
         '/this/is/a/test/path/two/file3.js',
         '/this/is/a/test/path/two/file4.js',
         '/this/is/a/test/path/three/file5.js'
      ];

      const relativePaths =
      [
         '../../../this/is/a/test/path/one/file.js',
         '../../../this/is/a/test/path/one/file2.js',
         '../../this/is/a/test/path/two/file3.js',
         '../../this/is/a/test/path/two/file4.js',
         '../../this/is/a/test/path/three/file5.js'
      ];

      let commonPath = fileUtil.commonPath(...paths);

      assert.strictEqual(commonPath, '/this/is/a/test/path/');

      commonPath = fileUtil.commonPath(...relativePaths);

      assert.strictEqual(commonPath, '../../');
   });

   it('copy', () =>
   {
      fileUtil.copy('./test/fixture/test.js', 'test3.js');

      assert.isTrue(fs.existsSync('./test/fixture/test3.js'));

      const readData = fs.readFileSync('./test/fixture/test3.js').toString();

      assert.strictEqual(readData, writeData);
   });

   it('create archive (1)', () =>
   {
      fileUtil.archiveCreate('archive');

      fileUtil.writeFile(writeData, 'test3.js');
      fileUtil.writeFile(writeData, 'test4.js');
      fileUtil.copy('./test/fixture/test.js', 'test.js');

      fileUtil.archiveFinalize();

      assert.isTrue(fs.existsSync('./test/fixture/archive.tar.gz'));
   });

   it('create archive (2)', (done) =>
   {
      fileUtil.archiveCreate('archive2');

      fileUtil.writeFile(writeData, 'test3.js');
      fileUtil.writeFile(writeData, 'test4.js');
      fileUtil.copy('./test/fixture/test.js', 'test.js');

      fileUtil.archiveCreate('archive');

      fileUtil.writeFile(writeData, 'test3.js');
      fileUtil.writeFile(writeData, 'test4.js');
      fileUtil.copy('./test/fixture/test.js', 'test.js');

      fileUtil.archiveFinalize();

      fileUtil.archiveFinalize().then(() =>
      {
         assert.isTrue(fs.existsSync('./test/fixture/archive2.tar.gz'));
         done();
      });
   });

   it('hydrateGlobs', () =>
   {
      // Glob upgrade for bare path / all inclusive
      let { files, globs } = fileUtil.hydrateGlob('./test/fixture');

      files = files.map((file) => path.parse(file).base);

      assert.strictEqual(JSON.stringify(files), globVerifyFiles);
      assert.strictEqual(JSON.stringify(globs), globVerifyGlobs);

      ({ files, globs } = fileUtil.hydrateGlob(['./test/fixture/*.gz', './test/fixture/*.js']));

      files = files.map((file) => path.parse(file).base);

      assert.strictEqual(JSON.stringify(files), globVerifyFiles);
      assert.strictEqual(JSON.stringify(globs), globVerifyGlobs2);
   });

   it('hydrateGlobs (throws)', () =>
   {
      assert.throws(() => fileUtil.hydrateGlob());
      assert.throws(() => fileUtil.hydrateGlob(true));
      assert.throws(() => fileUtil.hydrateGlob(['string', true]));
   });

   // This test will remove all files from `./test/fixture`.
   it('emptyRelativePath', () =>
   {
      let files = fs.readdirSync('./test/fixture');

      assert.lengthOf(files, 5);

      fileUtil.emptyRelativePath();

      files = fs.readdirSync('./test/fixture');

      assert.lengthOf(files, 0);
   });
});

const writeData =
`
/**
 * A comment.
 */
export default class Test
{
   constructor()
   {
      this.test = true;
   }
}
`;

const readLineData =
`3|  * A comment.
4|  */
5| export default class Test
6| {
7|    constructor()
8|    {
9|       this.test = true;
10|    }`;


const globVerifyFiles = '["archive.tar.gz","archive2.tar.gz","test.js","test2.js","test3.js"]';
const globVerifyGlobs = '["./test/fixture/**/*"]';

const globVerifyGlobs2 = '["./test/fixture/*.gz","./test/fixture/*.js"]';
