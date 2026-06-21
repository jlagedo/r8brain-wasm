/**
 * @file r8b_wasm.cpp
 *
 * @brief Thin C shim exposing r8brain-free-src to WebAssembly.
 *
 * Reuses the existing C API declared in "DLL/r8bsrc.h" (r8b_create,
 * r8b_delete, r8b_clear, r8b_inlen, r8b_process). Adds r8bw_process(), which
 * avoids the C++ "double*&" out-parameter of r8b_process() by writing the
 * address of the resampler's internal output buffer into a caller-supplied
 * slot in WASM linear memory.
 *
 * Compile together with "DLL/r8bsrc.cpp" and define R8BSRC_DECL to empty so
 * the symbols are plain (no dllexport/dllimport).
 */

#include "r8bsrc.h" // vendor/r8brain-free-src/DLL, on the include path via build.sh -I

extern "C" {

/**
 * Resamples one input block.
 *
 * @param rs     Resampler handle from r8b_create().
 * @param ip     Input buffer (offset in WASM heap), `len` doubles, owned by JS.
 *               Must not exceed the MaxInLen passed to r8b_create().
 * @param len    Number of input samples.
 * @param opptr  Address of a single pointer slot in the WASM heap. On return
 *               it holds the heap offset of the resampled data. That buffer is
 *               owned by the resampler and is valid only until the next
 *               r8bw_process()/r8b_clear()/r8b_delete() call on this handle.
 * @return       Number of output samples (can be 0 during the initial
 *               latency-fill phase).
 */

int r8bw_process( CR8BResampler rs, double* ip, int len, double** opptr )
{
	double* op = 0;
	const int n = r8b_process( rs, ip, len, op );
	*opptr = op;
	return( n );
}

} // extern "C"
