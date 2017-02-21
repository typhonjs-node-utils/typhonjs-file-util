import { assert } from 'chai';
import fs         from 'fs-extra';

import FileUtil   from '../../src/FileUtil.js';

const fileUtil = new FileUtil({ relativePath: './test/fixture' });

// Empty test fixture directory.
fs.emptydirSync('./test/fixture');

describe('FileUtil:', () =>
{
   it('writeFile:', () =>
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

   it('readLines:', () =>
   {
      const readLines = fileUtil.readLines('./test/fixture/test.js', 2, 10);

      assert.strictEqual(readLines.join('\n'), readLineData);
   });

   it('copy:', () =>
   {
      fileUtil.copy('./test/fixture/test.js', 'test3.js');

      assert.isTrue(fs.existsSync('./test/fixture/test3.js'));

      const readData = fs.readFileSync('./test/fixture/test3.js').toString();

      assert.strictEqual(readData, writeData);
   });

   it('create archive (1):', () =>
   {
      fileUtil.archiveCreate('archive');

      fileUtil.writeFile(writeData, 'test3.js');
      fileUtil.writeFile(writeData, 'test4.js');
      fileUtil.copy('./test/fixture/test.js', 'test.js');

      fileUtil.archiveFinalize();

      assert.isTrue(fs.existsSync('./test/fixture/archive.tar.gz'));
   });

   it('create archive (2):', (done) =>
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

   it('hydrateGlobs:', () =>
   {
      // Glob upgrade for bare path / all inclusive
      let { files, globs } = fileUtil.hydrateGlob('./test/fixture');

      assert.strictEqual(JSON.stringify(files), globVerifyFiles);
      assert.strictEqual(JSON.stringify(globs), globVerifyGlobs);

      ({ files, globs } = fileUtil.hydrateGlob(['./test/fixture/*.gz', './test/fixture/*.js']));

      assert.strictEqual(JSON.stringify(files), globVerifyFiles);
      assert.strictEqual(JSON.stringify(globs), globVerifyGlobs2);
   });

   it('hydrateGlobs (throws):', () =>
   {
      assert.throws(() => fileUtil.hydrateGlob());
      assert.throws(() => fileUtil.hydrateGlob(true));
      assert.throws(() => fileUtil.hydrateGlob(['string', true]));
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


const globVerifyFiles = '["/Volumes/Data/program/web/projects/TyphonJS/repos/typhonrt/typhonjs-node-utils/typhonjs-file-util/test/fixture/archive.tar.gz","/Volumes/Data/program/web/projects/TyphonJS/repos/typhonrt/typhonjs-node-utils/typhonjs-file-util/test/fixture/archive2.tar.gz","/Volumes/Data/program/web/projects/TyphonJS/repos/typhonrt/typhonjs-node-utils/typhonjs-file-util/test/fixture/test.js","/Volumes/Data/program/web/projects/TyphonJS/repos/typhonrt/typhonjs-node-utils/typhonjs-file-util/test/fixture/test2.js","/Volumes/Data/program/web/projects/TyphonJS/repos/typhonrt/typhonjs-node-utils/typhonjs-file-util/test/fixture/test3.js"]';
const globVerifyGlobs = '["./test/fixture/**/*"]';

const globVerifyGlobs2 = '["./test/fixture/*.gz","./test/fixture/*.js"]';