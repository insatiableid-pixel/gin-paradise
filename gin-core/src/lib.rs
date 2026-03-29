//! gin-core: High-performance Gin Rummy engine core.
//!
//! Provides fast card-set operations, meld detection, deadwood computation,
//! and optional Python bindings via PyO3 (enabled with the "python" feature).

pub mod card;
pub mod meld;

#[cfg(feature = "python")]
mod python;

#[cfg(feature = "python")]
use pyo3::prelude::*;

#[cfg(feature = "python")]
#[pymodule]
fn gin_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    python::register_module(m)?;
    Ok(())
}
