/** Frozen before the first recognition run on Pencil-eval-1. Do not regenerate
 * hashes after observing results: a changed model is a new experiment, and this
 * evaluated collection cannot then establish fresh independent accuracy.
 * Full policy/feature code is pinned below; no evaluation examples are templates.
 */
export const frozenPencilV1 = {
  id: 'pencil-v1',
  templateCount: 15,
  development: {
    path: 'fixtures/recorded/development/pencil-dev-1.json',
    sha256: '15ec56101a055df9280e8e03bb50b4414b50c09316a0ce50629dcd0de60736b9',
  },
  evaluation: {
    path: 'fixtures/recorded/evaluation/pencil-eval-1.json',
    sha256: '53abc2f6face9427fa206f39e6867199583eabc866cc0203c3908df000f87f2c',
  },
  sourceHashes: {
    'package.json': 'f9273a739b7f3240e0ee1a3fd1aec2d18d6ebd24b5c7a857bff2f9b18a409113',
    'package-lock.json': '535bceb958c6fc1e4a5205c66aabfc7672a876041811af5e610e31b97dd5a514',
    'src/config.ts': 'd5dcc336468735f28912d922db64859abd8148633538f7d70815387d48d91a9a',
    'src/recognize/templates.ts': 'f215e2029556b9847ad49af26c821d3e171a1dc82d01ac646181c29f25e7aa27',
    'src/recognize/geometry.ts': 'c701f195ad3ab42bce290ec9444d0c14e2c76a1575c938b29134d878652a4293',
    'src/recognize/classify.ts': 'a2230dd80be9c9dd45dc1e88cc27698ab83aa4d11dcc48b5814801ddb9078728',
    'src/fixtures/schema.ts': 'a8de0e712d0d1f06fe1aeae92e66e9a1e568bbf3d3f4aed38ac14f5b64b7954e',
    'src/store/schema.ts': 'e927b10cb195db275d32f40ab2b010f0e07a5270691633e430fde122375318de',
    'tests/fixtures/development.ts': '1dd1a156049657746365556b3375ff3435ab884aafd131e36b268789fe7fa121',
    'tests/fixtures/roles.ts': '1a1dff26ee9954b8894998f32ef16b2d3ebebcbf8980ec7ef0e317132e1e456d',
    'tests/fixtures/load.ts': '4b1c171230d2b83e981b3d72210bf42b1bf09651cc6b14c6d957c4bc3bc7770e',
    'tests/fixtures/classification.ts': 'd618d378a5251b444781fa3662a274ed5b8fb5b145eb54435e96b3a0e64184ad',
    'tests/evaluation/pencil-v1.test.ts': '9ac442e9913883cf815a340bf56361d5c0528dd8fb380e93528aefd0e8255c0c',
    'vitest.evaluation.config.ts': '2f5b081b39eb884377567d057a6471e93eeded2b6bc623c11da01ca80aa0fc24',
  },
} as const;
