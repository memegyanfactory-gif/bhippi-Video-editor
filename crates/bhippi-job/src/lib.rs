//! One Windows Job Object that holds Bhippi's heavy worker programs (llama.cpp, ComfyUI, Blender,
//! FFmpeg, the Python workers) to a share of this PC's processor and memory.
//!
//! The job is created the first time it is needed and lives as long as the app. Its limits can be
//! changed at any time, and the programs already inside follow them at once:
//!
//! - the processor: a hard cap on the job's total CPU rate;
//! - the memory: a limit on what the job's processes may commit together;
//! - the priority: below normal, so the desktop and the mouse stay responsive;
//! - kill-on-close: if Bhippi crashes, the job's programs go with it instead of lingering.
//!
//! A second, plain job (the "tied" job) holds the long-lived programs Bhippi starts that need no
//! limits (provider CLI agents, MCP servers, the capture browser, shells): no caps, normal priority,
//! only kill-on-close. Both jobs' handles are not inheritable, so no child can keep a job alive after
//! Bhippi ends; when the process ends for any reason, Windows closes the handles and ends everything
//! inside.
//!
//! Every call is a harmless no-op that reports "nothing" on other systems.

/// What the programs in the job use now.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
    /// Memory the job's processes have committed right now, bytes.
    pub used_bytes: u64,
    /// The most memory the job has used at once, bytes.
    pub peak_bytes: u64,
    /// Programs running in the job.
    pub processes: u32,
    /// Processor time all of them have used so far, seconds.
    pub cpu_seconds: f64,
}

/// Sets the job's processor cap (`cpu_rate` in hundredths of a percent, 1–10000) and its memory
/// limit in bytes (0 for none). Creates the job on first use.
pub fn apply(cpu_rate: u32, memory_limit: u64) -> Result<(), String> {
    imp::apply(cpu_rate.clamp(1, 10_000), memory_limit)
}

/// Puts a running program into the job, by its process handle (what `Child::as_raw_handle` gives).
pub fn contain(process_handle: usize) -> Result<(), String> {
    imp::contain(process_handle)
}

/// Ties a running program to Bhippi's life, by its process handle: no limits, but it (and anything
/// it starts) ends when Bhippi ends, however that happens. Do not also `contain` the same program.
pub fn tie(process_handle: usize) -> Result<(), String> {
    imp::tie(process_handle)
}

/// The limits the job holds now: (processor rate, memory limit bytes, 0 for none). None when there
/// is no job.
pub fn read_limits() -> Option<(u32, u64)> {
    imp::read_limits()
}

/// What the job's programs use now. None when there is no job.
pub fn usage() -> Option<Usage> {
    imp::usage()
}

/// Whether the job's memory limit stopped something in the last `seconds`.
pub fn memory_limit_hit_within(seconds: u64) -> bool {
    imp::memory_limit_hit_within(seconds)
}

/// Physical memory in this PC, bytes (0 when unknown).
pub fn total_memory() -> u64 {
    imp::total_memory()
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::Instant;
    use windows_sys::Win32::Foundation::{CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::IO::{CreateIoCompletionPort, GetQueuedCompletionStatus};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectAssociateCompletionPortInformation, JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
        JobObjectCpuRateControlInformation, JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject, JOBOBJECT_ASSOCIATE_COMPLETION_PORT,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_PROCESS_ID_LIST, JOBOBJECT_CPU_RATE_CONTROL_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_CPU_RATE_CONTROL_ENABLE, JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP, JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PRIORITY_CLASS,
    };
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::{OpenProcess, BELOW_NORMAL_PRIORITY_CLASS, PROCESS_QUERY_LIMITED_INFORMATION};

    /// The job's messages for a process or the job running into its memory limit.
    const MSG_PROCESS_MEMORY_LIMIT: u32 = 9;
    const MSG_JOB_MEMORY_LIMIT: u32 = 10;

    /// The job's handle as a number (0 when it could not be made).
    static JOB: OnceLock<usize> = OnceLock::new();
    /// The tied job's handle as a number (0 when it could not be made).
    static TIED: OnceLock<usize> = OnceLock::new();
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    /// When the memory limit last stopped something: milliseconds since EPOCH, plus one (0 = never).
    static LAST_HIT: AtomicU64 = AtomicU64::new(0);

    fn now_ms() -> u64 {
        EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1
    }

    fn last_error(what: &str) -> String {
        format!("{what}: {}", std::io::Error::last_os_error())
    }

    fn job() -> Result<HANDLE, String> {
        let raw = *JOB.get_or_init(|| {
            let _ = now_ms();
            // SAFETY: a plain call with no security attributes and no name; the handle is kept for the app's life.
            unsafe {
                let job = CreateJobObjectW(null(), null());
                if job.is_null() {
                    return 0;
                }
                SetHandleInformation(job, HANDLE_FLAG_INHERIT, 0);
                watch(job);
                job as usize
            }
        });
        if raw == 0 {
            Err("the job object could not be created".into())
        } else {
            Ok(raw as HANDLE)
        }
    }

    /// The tied job: kill-on-close and nothing else. Its handle is not inheritable.
    fn tied_job() -> Result<HANDLE, String> {
        let raw = *TIED.get_or_init(|| {
            // SAFETY: a plain call with no security attributes and no name; the handle is kept for the app's life.
            unsafe {
                let job = CreateJobObjectW(null(), null());
                if job.is_null() {
                    return 0;
                }
                SetHandleInformation(job, HANDLE_FLAG_INHERIT, 0);
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(job, JobObjectExtendedLimitInformation, (&raw const limits).cast::<c_void>(), size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0 {
                    CloseHandle(job);
                    return 0;
                }
                job as usize
            }
        });
        if raw == 0 {
            Err("the tied job object could not be created".into())
        } else {
            Ok(raw as HANDLE)
        }
    }

    pub fn tie(process_handle: usize) -> Result<(), String> {
        let job = tied_job()?;
        // SAFETY: both are handles the caller owns / this module keeps.
        if unsafe { AssignProcessToJobObject(job, process_handle as HANDLE) } == 0 {
            return Err(last_error("could not tie the program to Bhippi"));
        }
        Ok(())
    }

    /// Whether the two jobs' handles can be inherited by a child process (for the tests).
    #[cfg(test)]
    pub fn handles_inheritable() -> (bool, bool) {
        use windows_sys::Win32::Foundation::GetHandleInformation;
        let check = |job: Result<HANDLE, String>| {
            let mut flags = 0u32;
            // SAFETY: a valid handle and a local out-pointer.
            job.is_ok_and(|job| unsafe { GetHandleInformation(job, &mut flags) } != 0 && flags & HANDLE_FLAG_INHERIT != 0)
        };
        (check(job()), check(tied_job()))
    }

    /// Listens for the job's memory-limit messages on a completion port, so a program that dies from
    /// the limit can be told apart from one that crashed for another reason.
    unsafe fn watch(job: HANDLE) {
        let port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1);
        if port.is_null() {
            return;
        }
        let info = JOBOBJECT_ASSOCIATE_COMPLETION_PORT { CompletionKey: null_mut(), CompletionPort: port };
        let associated = SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, (&raw const info).cast::<c_void>(), size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32);
        if associated == 0 {
            CloseHandle(port);
            return;
        }
        let port = port as usize;
        let _ = std::thread::Builder::new().name("bhippi-job-watch".into()).spawn(move || loop {
            let (mut code, mut key, mut overlapped) = (0u32, 0usize, null_mut());
            // SAFETY: the port lives as long as the app; the out-pointers are this thread's own locals.
            let ok = unsafe { GetQueuedCompletionStatus(port as HANDLE, &mut code, &mut key, &mut overlapped, u32::MAX) };
            if ok == 0 && overlapped.is_null() {
                break;
            }
            if code == MSG_JOB_MEMORY_LIMIT || code == MSG_PROCESS_MEMORY_LIMIT {
                LAST_HIT.store(now_ms(), Ordering::Relaxed);
            }
        });
    }

    pub fn apply(cpu_rate: u32, memory_limit: u64) -> Result<(), String> {
        let job = job()?;
        // SAFETY: both structs are zeroed plain data, passed with their exact sizes.
        unsafe {
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PRIORITY_CLASS | if memory_limit > 0 { JOB_OBJECT_LIMIT_JOB_MEMORY } else { 0 };
            limits.BasicLimitInformation.PriorityClass = BELOW_NORMAL_PRIORITY_CLASS;
            limits.JobMemoryLimit = usize::try_from(memory_limit).unwrap_or(usize::MAX);
            if SetInformationJobObject(job, JobObjectExtendedLimitInformation, (&raw const limits).cast::<c_void>(), size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0 {
                return Err(last_error("could not set the job's memory limit"));
            }
            let mut cpu: JOBOBJECT_CPU_RATE_CONTROL_INFORMATION = zeroed();
            cpu.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
            cpu.Anonymous.CpuRate = cpu_rate;
            if SetInformationJobObject(job, JobObjectCpuRateControlInformation, (&raw const cpu).cast::<c_void>(), size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32) == 0 {
                return Err(last_error("could not set the job's processor cap"));
            }
        }
        Ok(())
    }

    pub fn contain(process_handle: usize) -> Result<(), String> {
        let job = job()?;
        // SAFETY: both are handles the caller owns / this module keeps.
        if unsafe { AssignProcessToJobObject(job, process_handle as HANDLE) } == 0 {
            return Err(last_error("could not add the program to the job"));
        }
        Ok(())
    }

    pub fn read_limits() -> Option<(u32, u64)> {
        let job = job().ok()?;
        // SAFETY: zeroed plain data, queried with exact sizes.
        unsafe {
            let mut cpu: JOBOBJECT_CPU_RATE_CONTROL_INFORMATION = zeroed();
            if QueryInformationJobObject(job, JobObjectCpuRateControlInformation, (&raw mut cpu).cast::<c_void>(), size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32, null_mut()) == 0 {
                return None;
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            if QueryInformationJobObject(job, JobObjectExtendedLimitInformation, (&raw mut limits).cast::<c_void>(), size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32, null_mut()) == 0 {
                return None;
            }
            let memory = if limits.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_JOB_MEMORY != 0 { limits.JobMemoryLimit as u64 } else { 0 };
            Some((cpu.Anonymous.CpuRate, memory))
        }
    }

    pub fn usage() -> Option<super::Usage> {
        let job = job().ok()?;
        // SAFETY: zeroed plain data and a buffer large enough for the header and 256 process ids.
        unsafe {
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = zeroed();
            if QueryInformationJobObject(job, JobObjectBasicAccountingInformation, (&raw mut accounting).cast::<c_void>(), size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32, null_mut()) == 0 {
                return None;
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            let peak = if QueryInformationJobObject(job, JobObjectExtendedLimitInformation, (&raw mut limits).cast::<c_void>(), size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32, null_mut()) != 0 {
                limits.PeakJobMemoryUsed as u64
            } else {
                0
            };
            let mut buffer = [0u64; 258];
            let mut used = 0u64;
            if QueryInformationJobObject(job, JobObjectBasicProcessIdList, buffer.as_mut_ptr().cast::<c_void>(), size_of::<[u64; 258]>() as u32, null_mut()) != 0 {
                let list = buffer.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
                let count = ((*list).NumberOfProcessIdsInList as usize).min(256);
                let ids = (&raw const (*list).ProcessIdList).cast::<usize>();
                for index in 0..count {
                    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, *ids.add(index) as u32);
                    if process.is_null() {
                        continue;
                    }
                    let mut counters: PROCESS_MEMORY_COUNTERS = zeroed();
                    counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                    if GetProcessMemoryInfo(process, &mut counters, counters.cb) != 0 {
                        used += counters.PagefileUsage as u64;
                    }
                    CloseHandle(process);
                }
            }
            let ticks = accounting.TotalUserTime.max(0) + accounting.TotalKernelTime.max(0);
            Some(super::Usage { used_bytes: used, peak_bytes: peak, processes: accounting.ActiveProcesses, cpu_seconds: ticks as f64 / 1e7 })
        }
    }

    pub fn memory_limit_hit_within(seconds: u64) -> bool {
        let at = LAST_HIT.load(Ordering::Relaxed);
        at != 0 && now_ms().saturating_sub(at) <= seconds.saturating_mul(1000)
    }

    pub fn total_memory() -> u64 {
        // SAFETY: the struct is zeroed plain data with its length set, as the call requires.
        unsafe {
            let mut status: MEMORYSTATUSEX = zeroed();
            status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut status) == 0 {
                return 0;
            }
            status.ullTotalPhys
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn apply(_cpu_rate: u32, _memory_limit: u64) -> Result<(), String> {
        Ok(())
    }
    pub fn contain(_process_handle: usize) -> Result<(), String> {
        Ok(())
    }
    pub fn tie(_process_handle: usize) -> Result<(), String> {
        Ok(())
    }
    pub fn read_limits() -> Option<(u32, u64)> {
        None
    }
    pub fn usage() -> Option<super::Usage> {
        None
    }
    pub fn memory_limit_hit_within(_seconds: u64) -> bool {
        false
    }
    pub fn total_memory() -> u64 {
        0
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;

    #[test]
    fn a_contained_program_runs_under_the_cap_and_the_limit() {
        apply(2500, 8_000_000_000).expect("limits apply");
        let mut child = std::process::Command::new("ping").args(["-n", "4", "127.0.0.1"]).creation_flags(0x0800_0000).stdout(std::process::Stdio::null()).spawn().expect("ping starts");
        contain(child.as_raw_handle() as usize).expect("ping joins the job");
        assert_eq!(read_limits(), Some((2500, 8_000_000_000)));
        let usage = usage().expect("the job reports");
        assert_eq!(usage.processes, 1);
        // The limits can change while the program runs.
        apply(7500, 0).expect("limits change");
        assert_eq!(read_limits(), Some((7500, 0)));
        assert!(total_memory() > 0);
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Proof that the jobs end what is inside them when the process that owns them ends: the test binary
/// re-runs itself as a helper that makes the job, puts a long-running `ping` in it and exits at once;
/// the test then checks the `ping` is gone.
#[cfg(all(test, windows))]
mod survival_tests {
    use super::*;
    
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// Runs only inside the helper process (the env var is unset in a normal run, so it passes at once).
    #[test]
    fn helper_makes_a_job_and_exits() {
        let Ok(kind) = std::env::var("BHIPPI_JOB_HELPER") else { return };
        let grandchild = Command::new("ping").args(["-n", "30", "127.0.0.1"]).creation_flags(CREATE_NO_WINDOW).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
        let Ok(grandchild) = grandchild else { std::process::exit(2) };
        let handle = grandchild.as_raw_handle() as usize;
        let joined = if kind == "tied" {
            tie(handle)
        } else {
            apply(5000, 0).and_then(|()| contain(handle))
        };
        if joined.is_err() {
            std::process::exit(3);
        }
        let Ok(out) = std::env::var("BHIPPI_JOB_HELPER_OUT") else { std::process::exit(4) };
        if std::fs::write(out, grandchild.id().to_string()).is_err() {
            std::process::exit(5);
        }
        // Exit without any clean-up, as a crash or a kill would: only the job's handle closing can end the grandchild.
        std::process::exit(0);
    }

    /// Ends the grandchild if the test fails before it is gone.
    struct Cleanup(u32);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            // SAFETY: a plain open/terminate/close of a process id this test learned.
            unsafe {
                let process = OpenProcess(PROCESS_TERMINATE, 0, self.0);
                if !process.is_null() {
                    TerminateProcess(process, 1);
                    CloseHandle(process);
                }
            }
        }
    }

    /// True when the process ended within `wait_ms` (or no longer exists).
    fn gone_within(pid: u32, wait_ms: u32) -> bool {
        // SAFETY: a plain open/wait/close of a process id this test learned.
        unsafe {
            let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if process.is_null() {
                return true;
            }
            let done = WaitForSingleObject(process, wait_ms) == WAIT_OBJECT_0;
            CloseHandle(process);
            done
        }
    }

    fn run_helper(kind: &str) {
        let exe = std::env::current_exe().expect("the test binary's path");
        let out = std::env::temp_dir().join(format!("bhippi-job-helper-{kind}-{}.pid", std::process::id()));
        let _ = std::fs::remove_file(&out);
        let mut helper = Command::new(exe)
            .args(["--exact", "survival_tests::helper_makes_a_job_and_exits", "--test-threads=1"])
            .env("BHIPPI_JOB_HELPER", kind)
            .env("BHIPPI_JOB_HELPER_OUT", &out)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the helper starts");
        let status = helper.wait().expect("the helper ends");
        let pid = std::fs::read_to_string(&out).ok().and_then(|text| text.trim().parse::<u32>().ok());
        let _ = std::fs::remove_file(&out);
        let pid = pid.unwrap_or_else(|| panic!("the helper reported no grandchild (exit {status})"));
        let _cleanup = Cleanup(pid);
        assert!(status.success(), "the helper failed: {status}");
        assert!(gone_within(pid, 5000), "the {kind} job left its program (pid {pid}) running after its owner ended");
    }

    #[test]
    fn a_tied_program_ends_when_its_owner_ends() {
        run_helper("tied");
    }

    #[test]
    fn a_contained_program_ends_when_its_owner_ends() {
        run_helper("heavy");
    }

    #[test]
    fn the_jobs_are_not_inheritable() {
        assert_eq!(imp::handles_inheritable(), (false, false));
    }

    #[test]
    fn tying_a_program_in_the_same_process_works() {
        let mut child = Command::new("ping").args(["-n", "30", "127.0.0.1"]).creation_flags(CREATE_NO_WINDOW).stdout(Stdio::null()).spawn().expect("ping starts");
        let _cleanup = Cleanup(child.id());
        tie(child.as_raw_handle() as usize).expect("ping is tied");
        assert!(!gone_within(child.id(), 300));
        let _ = child.kill();
        let _ = child.wait();
    }
}
